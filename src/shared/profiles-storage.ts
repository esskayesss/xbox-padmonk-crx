// Typed, framework-free storage layer for the "Bind Profiles" feature.
//
// This module owns the durable `profiles` key (the ProfilesState store) and the
// ephemeral per-tab `tab:${tabId}` records in chrome.storage.session. It is the
// chrome-aware companion to the PURE core/profiles.ts (which owns the shapes and
// every transform but knows nothing about chrome.* or storage).
//
// It deliberately mirrors src/shared/storage.ts's discipline so the two behave
// identically and a later agent can retire storage.ts cleanly:
//   - chrome.storage.local is the FAST, LIVE store. Content scripts read it and
//     it fires onChanged synchronously in the same profile, so writing local is
//     the instant live-update path. We READ it first and WRITE it immediately.
//   - chrome.storage.sync is the cross-device BACKUP. It is slower, rate-limited,
//     and quota-constrained, so we only write it on a shared 400ms debounce and
//     only ever READ it as a fallback for installs that predate the local store.
//   - On a sync-only profile we MIGRATE into local on first read so every
//     subsequent read is fast and the live-update path works.
//   - A LEGACY install only has the old flat `config` key: on first read we
//     migrate it into a ProfilesState, persist it under `profiles`, and DELETE
//     the legacy key from both areas so the migration runs exactly once.
//
// All durable reads pass through normalizeProfilesState so callers always get a
// complete, invariant-satisfying ProfilesState (>= 1 profile, valid defaults,
// clamped numerics, recovered bindings) — never a partial/old/untrusted shape.
//
// The session store is in-memory and per-tab. Every access is GUARDED because
// chrome.storage.session is unavailable in the MAIN world and in vitest; missing
// session support degrades to null/no-op rather than throwing.

import { resolveUiLocale } from '../core/i18n';
import {
	type ProfilesState,
	type TabProfile,
	migrateLegacyConfig,
	normalizeProfilesState,
} from '../core/profiles';

/** Durable store key — the new ProfilesState home. */
const KEY = 'profiles';
/** Legacy flat-Config key we migrate FROM and then delete. */
const LEGACY_KEY = 'config';
/** Session key prefix for a per-tab record. */
const TAB_PREFIX = 'tab:';
const SYNC_DEBOUNCE_MS = 400;

/**
 * Detect the browser UI language and resolve it to a supported locale for
 * first-run seeding. Guarded: chrome.i18n is absent in the MAIN-world content
 * script and in vitest, so any failure falls back to the base locale. This is a
 * verbatim mirror of storage.ts's detectUiLocale so seeding behaves identically.
 */
function detectUiLocale(): ProfilesState['globals']['locale'] {
	try {
		const ui = chrome?.i18n?.getUILanguage?.() ?? '';
		return resolveUiLocale(ui);
	} catch {
		return resolveUiLocale('');
	}
}

/** Promise-wrapped chrome.storage.<area>.get(key). Resolves the raw value. */
function rawGet(area: chrome.storage.StorageArea, key: string): Promise<unknown> {
	return new Promise((resolve) => {
		try {
			area.get(key, (res) => {
				// A failed read (quota/permission) is distinct from "nothing stored";
				// surface it so a real failure isn't silently read as defaults.
				const err = chrome.runtime?.lastError;
				if (err) console.warn('padmonk: profiles read failed:', err.message);
				resolve(res ? res[key] : undefined);
			});
		} catch (e) {
			console.warn('padmonk: profiles read threw:', e);
			resolve(undefined);
		}
	});
}

/** Promise-wrapped chrome.storage.<area>.set({ [key]: value }). */
function rawSet(area: chrome.storage.StorageArea, key: string, value: unknown): Promise<void> {
	return new Promise((resolve) => {
		try {
			area.set({ [key]: value }, () => {
				// Don't let a quota/permission write failure pass as success silently.
				const err = chrome.runtime?.lastError;
				if (err) console.warn('padmonk: profiles write failed:', err.message);
				resolve();
			});
		} catch (e) {
			console.warn('padmonk: profiles write threw:', e);
			resolve();
		}
	});
}

/** Promise-wrapped chrome.storage.<area>.remove(key). Best-effort, guarded. */
function rawRemove(area: chrome.storage.StorageArea, key: string): Promise<void> {
	return new Promise((resolve) => {
		try {
			area.remove(key, () => {
				const err = chrome.runtime?.lastError;
				if (err) console.warn('padmonk: profiles remove failed:', err.message);
				resolve();
			});
		} catch (e) {
			console.warn('padmonk: profiles remove threw:', e);
			resolve();
		}
	});
}

/**
 * Read the durable ProfilesState.
 *
 * Read order (see plan §4):
 *   1. `profiles` key: local → sync fallback (migrate to local) → normalize.
 *   2. else LEGACY `config`: migrate → persist `profiles` → delete `config` from
 *      both areas.
 *   3. else true first run: synthesize one Default profile, seed globals.locale
 *      from the browser UI language, persist.
 *
 * The result is always normalized, so callers never defend against partial
 * shapes.
 */
export async function readProfilesState(): Promise<ProfilesState> {
	// 1. The new `profiles` store. Local-first, sync fallback + migrate-to-local.
	const local = await rawGet(chrome.storage.local, KEY);
	if (local != null) return normalizeProfilesState(local);

	const sync = await rawGet(chrome.storage.sync, KEY);
	if (sync != null) {
		const normalized = normalizeProfilesState(sync);
		await rawSet(chrome.storage.local, KEY, normalized);
		return normalized;
	}

	// 2. Legacy flat `config` (pre-profiles installs). Local-first, sync fallback.
	const legacyLocal = await rawGet(chrome.storage.local, LEGACY_KEY);
	const legacy = legacyLocal != null ? legacyLocal : await rawGet(chrome.storage.sync, LEGACY_KEY);
	if (legacy != null) {
		const migrated = migrateLegacyConfig(legacy);
		// Persist under the new key (local immediate, sync debounced) BEFORE we drop
		// the legacy key, so a crash mid-migration never loses the user's config.
		await writeProfilesState(migrated);
		// One-shot cleanup: the legacy key must never be re-read after this.
		await rawRemove(chrome.storage.local, LEGACY_KEY);
		await rawRemove(chrome.storage.sync, LEGACY_KEY);
		// migrateLegacyConfig already returns a normalized state and writeProfilesState
		// normalized it again on persist; a third pass here would be redundant.
		return migrated;
	}

	// 3. True first run: nothing stored anywhere. Synthesize a Default profile and
	// seed the locale from the browser UI language (a one-time seeding concern,
	// NOT part of the normalized shape). A later manual override wins by writing
	// local, which this branch skips.
	const seeded = normalizeProfilesState(undefined);
	seeded.globals.locale = detectUiLocale();
	await rawSet(chrome.storage.local, KEY, seeded);
	return seeded;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persist the ProfilesState.
 *
 * Normalizes first (so a caller can't write a broken shape), writes
 * chrome.storage.local immediately (instant live-update via onChanged), then
 * debounces the chrome.storage.sync backup so rapid mutations don't burn the
 * sync write quota. The debounce timer is shared module-scope, exactly like
 * storage.ts, so all writers coalesce.
 *
 * Returns the local-write promise; the sync backup completes asynchronously.
 */
export function writeProfilesState(state: ProfilesState): Promise<void> {
	const normalized = normalizeProfilesState(state);
	const localWrite = rawSet(chrome.storage.local, KEY, normalized);
	if (syncTimer != null) clearTimeout(syncTimer);
	syncTimer = setTimeout(() => {
		syncTimer = null;
		void rawSet(chrome.storage.sync, KEY, normalized);
	}, SYNC_DEBOUNCE_MS);
	return localWrite;
}

/**
 * Subscribe to ProfilesState changes in either durable store. The new value is
 * normalized before invoking cb. Returns an unsubscribe function. Mirrors
 * storage.ts's onConfigChanged exactly (local|sync areas, `profiles` key).
 */
export function onProfilesChanged(cb: (state: ProfilesState) => void): () => void {
	const listener = (
		changes: { [key: string]: chrome.storage.StorageChange },
		area: chrome.storage.AreaName,
	): void => {
		if ((area === 'local' || area === 'sync') && changes[KEY]) {
			cb(normalizeProfilesState(changes[KEY].newValue));
		}
	};
	try {
		chrome.storage.onChanged.addListener(listener);
	} catch {
		return () => {};
	}
	return () => {
		try {
			chrome.storage.onChanged.removeListener(listener);
		} catch {
			/* no-op */
		}
	};
}

// ---------------------------------------------------------------------------
// Session (per-tab) helpers — chrome.storage.session, in-memory, per-tab.
//
// Every access is GUARDED: chrome.storage.session is undefined in the MAIN world
// and in vitest unless explicitly mocked. We treat its absence as "no per-tab
// state" rather than an error, so callers in any world degrade gracefully.
// ---------------------------------------------------------------------------

/** The session area if it exists in this world, else null. */
function sessionArea(): chrome.storage.StorageArea | null {
	try {
		return chrome?.storage?.session ?? null;
	} catch {
		return null;
	}
}

/** Build the session key for a tab. */
function tabKey(tabId: number): string {
	return `${TAB_PREFIX}${tabId}`;
}

/**
 * Validate an untrusted session value into a TabProfile, or null when the shape
 * is wrong. The session store is writable by untrusted contexts, so every read
 * is validated here (productId/slug are string|null, profileId is a string) to
 * keep the module's "all reads validated" discipline honest.
 */
function normalizeTabProfile(raw: unknown): TabProfile | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const r = raw as Record<string, unknown>;
	const productIdOk = r.productId === null || typeof r.productId === 'string';
	const slugOk = r.slug === null || typeof r.slug === 'string';
	if (!productIdOk || !slugOk || typeof r.profileId !== 'string') return null;
	return {
		productId: r.productId as string | null,
		slug: r.slug as string | null,
		profileId: r.profileId,
	};
}

/**
 * Read a tab's ephemeral profile record. Resolves null when the entry is absent
 * OR the session area is unavailable (MAIN world / vitest).
 */
export async function readTabProfile(tabId: number): Promise<TabProfile | null> {
	const area = sessionArea();
	if (area == null) return null;
	const raw = await rawGet(area, tabKey(tabId));
	return normalizeTabProfile(raw);
}

/**
 * Write a tab's ephemeral profile record. No-op when the session area is
 * unavailable.
 */
export async function writeTabProfile(tabId: number, tab: TabProfile): Promise<void> {
	const area = sessionArea();
	if (area == null) return;
	await rawSet(area, tabKey(tabId), tab);
}

/**
 * Remove a tab's ephemeral profile record (used on chrome.tabs.onRemoved).
 * No-op when the session area is unavailable.
 */
export async function clearTabProfile(tabId: number): Promise<void> {
	const area = sessionArea();
	if (area == null) return;
	await rawRemove(area, tabKey(tabId));
}

/**
 * Grant untrusted contexts (content scripts in the MAIN/ISOLATED world) the
 * ability to write chrome.storage.session. The service worker calls this once on
 * startup and on install. Guarded: setAccessLevel may not exist in older Chrome
 * or in test/MAIN worlds. Idempotent and safe to call repeatedly.
 */
export async function setSessionAccessLevel(): Promise<void> {
	const area = sessionArea() as
		| (chrome.storage.StorageArea & {
				setAccessLevel?: (opts: { accessLevel: string }) => Promise<void> | void;
		  })
		| null;
	if (area == null || typeof area.setAccessLevel !== 'function') return;
	try {
		await area.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
	} catch (e) {
		console.warn('padmonk: setAccessLevel failed:', e);
	}
}

/**
 * Subscribe to per-tab session changes. Filters storage.onChanged to the
 * 'session' area, parses `tab:${id}` keys, and invokes cb with the parsed tabId
 * and the new TabProfile (or null on removal). Returns an unsubscribe function.
 * Guarded so a world without storage.onChanged degrades to a no-op unsubscribe.
 */
export function onTabProfileChanged(
	cb: (tabId: number, tab: TabProfile | null) => void,
): () => void {
	const listener = (
		changes: { [key: string]: chrome.storage.StorageChange },
		area: chrome.storage.AreaName,
	): void => {
		if (area !== 'session') return;
		for (const [key, change] of Object.entries(changes)) {
			if (!key.startsWith(TAB_PREFIX)) continue;
			const tabId = Number(key.slice(TAB_PREFIX.length));
			if (!Number.isFinite(tabId)) continue;
			const next = normalizeTabProfile(change.newValue);
			cb(tabId, next);
		}
	};
	try {
		chrome.storage.onChanged.addListener(listener);
	} catch {
		return () => {};
	}
	return () => {
		try {
			chrome.storage.onChanged.removeListener(listener);
		} catch {
			/* no-op */
		}
	};
}
