import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import { migrateLegacyConfig, normalizeProfilesState } from '../src/core/profiles';
import type { ProfilesState, TabProfile } from '../src/core/profiles';

// ---- in-memory chrome.storage mock -----------------------------------------
//
// Models chrome.storage.local + .sync + .session as plain object stores plus a
// shared onChanged dispatcher, so we can assert local-first reads, sync->local
// migration, legacy-config migration + key removal, the debounced sync backup,
// onChanged normalization, and per-tab session round-trips without a real
// browser. .session additionally carries a setAccessLevel spy.

type Store = Record<string, unknown>;
type ChangeListener = (
	changes: { [key: string]: chrome.storage.StorageChange },
	area: chrome.storage.AreaName,
) => void;

let localStore: Store;
let syncStore: Store;
let sessionStore: Store;
let listeners: ChangeListener[];
let setAccessLevelSpy: ReturnType<typeof vi.fn>;

function makeArea(store: () => Store, area: chrome.storage.AreaName) {
	return {
		get(key: string, cb: (items: Store) => void) {
			const s = store();
			cb(key in s ? { [key]: s[key] } : {});
		},
		set(items: Store, cb?: () => void) {
			const s = store();
			const changes: { [k: string]: chrome.storage.StorageChange } = {};
			for (const [k, v] of Object.entries(items)) {
				changes[k] = { oldValue: s[k], newValue: v };
				s[k] = v;
			}
			cb?.();
			for (const l of listeners) l(changes, area);
		},
		remove(key: string, cb?: () => void) {
			const s = store();
			const changes: { [k: string]: chrome.storage.StorageChange } = {};
			if (key in s) {
				changes[key] = { oldValue: s[key], newValue: undefined };
				delete s[key];
			}
			cb?.();
			for (const l of listeners) l(changes, area);
		},
	};
}

function installChrome(withSession = true) {
	const session = makeArea(() => sessionStore, 'session') as ReturnType<typeof makeArea> & {
		setAccessLevel: ReturnType<typeof vi.fn>;
	};
	session.setAccessLevel = setAccessLevelSpy;
	(globalThis as unknown as { chrome: unknown }).chrome = {
		storage: {
			local: makeArea(() => localStore, 'local'),
			sync: makeArea(() => syncStore, 'sync'),
			...(withSession ? { session } : {}),
			onChanged: {
				addListener: (l: ChangeListener) => listeners.push(l),
				removeListener: (l: ChangeListener) => {
					listeners = listeners.filter((x) => x !== l);
				},
			},
		},
	};
}

beforeEach(() => {
	localStore = {};
	syncStore = {};
	sessionStore = {};
	listeners = [];
	setAccessLevelSpy = vi.fn(() => Promise.resolve());
	vi.useFakeTimers();
	installChrome();
});

afterEach(() => {
	vi.useRealTimers();
	vi.resetModules();
});

// Re-import fresh each test so the module-level debounce timer is isolated.
async function loadStorage() {
	return import('../src/shared/profiles-storage');
}

describe('readProfilesState', () => {
	it('reads the profiles key local-first and normalizes it', async () => {
		// Out-of-range numerics survive into local but must be clamped on read.
		const raw = normalizeProfilesState(undefined);
		raw.profiles[0].sensitivity = 999;
		localStore.profiles = raw;
		const { readProfilesState } = await loadStorage();
		const state = await readProfilesState();
		expect(state.profiles[0].sensitivity).toBe(0.05); // clamped
		expect(syncStore.profiles).toBeUndefined(); // local hit: sync untouched
	});

	it('falls back to sync and migrates the profiles store into local', async () => {
		const raw = normalizeProfilesState(undefined);
		raw.globals.enabled = false;
		syncStore.profiles = raw;
		const { readProfilesState } = await loadStorage();
		const state = await readProfilesState();
		expect(state.globals.enabled).toBe(false);
		// migrated copy now lives in local
		expect((localStore.profiles as ProfilesState).globals.enabled).toBe(false);
	});

	it('migrates a legacy config key, persists profiles, and removes the legacy key from both areas', async () => {
		localStore.config = { ...DEFAULT_CONFIG, sensitivity: 0.02 };
		syncStore.config = { ...DEFAULT_CONFIG, sensitivity: 0.02 };
		const { readProfilesState } = await loadStorage();
		const state = await readProfilesState();

		// One Default profile carrying the migrated per-profile fields.
		expect(state.profiles).toHaveLength(1);
		expect(state.profiles[0].name).toBe('Default');
		expect(state.profiles[0].sensitivity).toBeCloseTo(0.02);

		// Persisted under the new key in local immediately.
		expect(localStore.profiles).toBeDefined();
		// Legacy key gone from BOTH areas.
		expect('config' in localStore).toBe(false);
		expect('config' in syncStore).toBe(false);

		// Debounced sync backup of the new store lands at 400ms.
		await vi.advanceTimersByTimeAsync(400);
		expect(syncStore.profiles).toBeDefined();
	});

	it('seeds one Default profile and the locale from chrome.i18n on true first run', async () => {
		(globalThis as unknown as { chrome: typeof chrome }).chrome.i18n = {
			getUILanguage: vi.fn(() => 'pt-PT'),
		} as unknown as typeof chrome.i18n;

		const { readProfilesState } = await loadStorage();
		const seeded = await readProfilesState();
		expect(seeded.profiles).toHaveLength(1);
		expect(seeded.profiles[0].name).toBe('Default');
		expect(seeded.globals.locale).toBe('pt-BR');
		expect((localStore.profiles as ProfilesState).globals.locale).toBe('pt-BR');
	});

	it('returns a normalized Default with base locale when nothing stored and chrome.i18n is absent', async () => {
		const { readProfilesState } = await loadStorage();
		const state = await readProfilesState();
		expect(state.profiles).toHaveLength(1);
		expect(state.globals.locale).toBe(DEFAULT_CONFIG.locale);
	});
});

describe('writeProfilesState', () => {
	it('writes local immediately and debounces the sync backup', async () => {
		const { writeProfilesState } = await loadStorage();
		const state = normalizeProfilesState(undefined);
		state.globals.enabled = false;
		await writeProfilesState(state);
		expect((localStore.profiles as ProfilesState).globals.enabled).toBe(false); // instant
		expect(syncStore.profiles).toBeUndefined(); // not yet
		vi.advanceTimersByTime(400);
		expect((syncStore.profiles as ProfilesState).globals.enabled).toBe(false); // debounced
	});

	it('coalesces rapid writes into one sync backup', async () => {
		const { writeProfilesState } = await loadStorage();
		const base = normalizeProfilesState(undefined);
		await writeProfilesState({ ...base, globals: { ...base.globals, locale: 'de' } });
		await writeProfilesState({ ...base, globals: { ...base.globals, locale: 'es' } });
		await writeProfilesState({ ...base, globals: { ...base.globals, locale: 'fr' } });
		expect(syncStore.profiles).toBeUndefined();
		vi.advanceTimersByTime(400);
		expect((syncStore.profiles as ProfilesState).globals.locale).toBe('fr');
	});
});

describe('onProfilesChanged', () => {
	it('normalizes the new value and supports unsubscribe', async () => {
		const { onProfilesChanged } = await loadStorage();
		const seen: ProfilesState[] = [];
		const off = onProfilesChanged((s) => seen.push(s));

		const raw = normalizeProfilesState(undefined);
		raw.profiles[0].sensitivity = 999; // out of range
		(globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set({
			profiles: raw,
		});
		expect(seen).toHaveLength(1);
		expect(seen[0].profiles[0].sensitivity).toBe(0.05); // clamped

		off();
		(globalThis as unknown as { chrome: typeof chrome }).chrome.storage.local.set({
			profiles: raw,
		});
		expect(seen).toHaveLength(1); // no further callbacks after unsubscribe
	});
});

describe('session helpers', () => {
	const tab: TabProfile = { productId: 'prod-1', slug: 'halo', profileId: 'p_abc' };

	it('round-trips read/write/clear via the session store', async () => {
		const { readTabProfile, writeTabProfile, clearTabProfile } = await loadStorage();
		expect(await readTabProfile(7)).toBeNull();
		await writeTabProfile(7, tab);
		expect(sessionStore['tab:7']).toEqual(tab);
		expect(await readTabProfile(7)).toEqual(tab);
		await clearTabProfile(7);
		expect('tab:7' in sessionStore).toBe(false);
		expect(await readTabProfile(7)).toBeNull();
	});

	it('setSessionAccessLevel calls the spy with TRUSTED_AND_UNTRUSTED_CONTEXTS', async () => {
		const { setSessionAccessLevel } = await loadStorage();
		await setSessionAccessLevel();
		expect(setAccessLevelSpy).toHaveBeenCalledWith({
			accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
		});
	});

	it('onTabProfileChanged parses tab keys and reports removals as null', async () => {
		const { onTabProfileChanged, writeTabProfile, clearTabProfile } = await loadStorage();
		const events: Array<{ tabId: number; tab: TabProfile | null }> = [];
		const off = onTabProfileChanged((tabId, t) => events.push({ tabId, tab: t }));

		await writeTabProfile(42, tab);
		expect(events).toEqual([{ tabId: 42, tab }]);

		await clearTabProfile(42);
		expect(events[1]).toEqual({ tabId: 42, tab: null });

		off();
		await writeTabProfile(42, tab);
		expect(events).toHaveLength(2); // no callbacks after unsubscribe
	});

	it('no-ops gracefully when chrome.storage.session is undefined', async () => {
		installChrome(false); // rebuild chrome without the session area
		const {
			readTabProfile,
			writeTabProfile,
			clearTabProfile,
			setSessionAccessLevel,
			onTabProfileChanged,
		} = await loadStorage();

		expect(await readTabProfile(1)).toBeNull();
		await expect(writeTabProfile(1, tab)).resolves.toBeUndefined();
		await expect(clearTabProfile(1)).resolves.toBeUndefined();
		await expect(setSessionAccessLevel()).resolves.toBeUndefined();
		expect(setAccessLevelSpy).not.toHaveBeenCalled();
		// subscribing is still safe and unsubscribe is a no-op
		const off = onTabProfileChanged(() => {});
		expect(() => off()).not.toThrow();
	});
});
