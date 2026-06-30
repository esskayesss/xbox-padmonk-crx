// padmonk bridge — ISOLATED content-script world.
//
// Only this world has chrome.* APIs. The MAIN-world inject coordinator has NO
// chrome.* access (different JS world), so the bridge is the sole channel that:
//   1. reads the stored profiles state (local-first, sync-fallback + migrate;
//      see shared/profiles-storage.ts for the rationale),
//   2. RESOLVES the per-tab active profile (Phase 2: tabId + storage.session +
//      per-game defaults) and projects it to a Config, and
//   3. resolves extension asset URLs via chrome.runtime.getURL and ships them to
//      MAIN through window.postMessage. MAIN cannot compute these URLs itself.
//
// fontUrl (Bug 6): legacy hotlinked Bahnschrift from the xbox CDN. We now ship a
// bundled, web-accessible font at assets/fonts/bahnschrift.woff and pass its
// extension URL here. If the file is absent / fails to load, MAIN-world UI
// (P5/P6) MUST fall back to the system stack:
//   "Bahnschrift", "Segoe UI", system-ui, sans-serif
// See assets/fonts/README.md.

import {
	onProfilesChanged,
	readProfilesState,
	readTabProfile,
	writeProfilesState,
	writeTabProfile,
} from '../shared/profiles-storage';
import {
	projectProfileConfig,
	resolveProfileId,
	setGameDefault,
	setGlobalDefault,
	updateProfile,
	upsertSeenGame,
} from '../core/profiles';
import type { ProfilesState } from '../core/profiles';
import { gameNameFromTitle, gameRefFromPath } from './page-match';
import type { Action, Config } from '../core/types';

/**
 * The payload posted to MAIN. Beyond the resolved Config + asset URLs, Phase 2
 * threads everything the Phase-3 overlay will need (profile list, the resolved
 * active id, the current game context, and the context's current default) plus
 * the callback seams (set-active-profile / save-as-default) the overlay emits.
 */
interface BridgePayload {
	__padmonk: 'config';
	config: Config | Record<string, never>;
	controllerUrl: string;
	iconUrl: string;
	bindIconBase: string;
	fontUrl: string;
	/** All profiles as {id,name} for the overlay dropselect. */
	profiles: { id: string; name: string }[];
	/** The profile id this tab currently resolves to. */
	activeProfileId: string;
	/** The product id of the game in this tab, or null off a game. */
	productId: string | null;
	/** The (localized, label-only) slug of the game in this tab, or null. */
	slug: string | null;
	/** The captured human name for productId from the seen-games registry, or null. */
	gameName: string | null;
	/** The current default profile id for THIS context (game default or global). */
	contextDefaultProfileId: string;
}

/** chrome.runtime.getURL with a guard for when chrome.* is unavailable. */
function getURL(path: string): string {
	try {
		return chrome.runtime?.getURL?.(path) ?? '';
	} catch {
		return '';
	}
}

/** Freshly-resolved asset URLs (independent of storage, posted on every payload). */
function assetUrls(): Pick<
	BridgePayload,
	'controllerUrl' | 'iconUrl' | 'bindIconBase' | 'fontUrl'
> {
	return {
		controllerUrl: getURL('assets/xbox-controller.svg'),
		iconUrl: getURL('icons/padmonk.png'),
		bindIconBase: getURL('assets/bind-icons/'),
		// NEW (Bug 6): bundled font, no longer hotlinked from the xbox CDN.
		fontUrl: getURL('assets/fonts/bahnschrift.woff'),
	};
}

// ---------------------------------------------------------------------------
// Per-tab resolution state (module-scoped).
// ---------------------------------------------------------------------------
let tabId: number | null = null;
let pstate: ProfilesState | null = null;
let activeProfileId = '';
let productId: string | null = null;
let slug: string | null = null;

// Seen-games throttle: only upsert a given productId once per page load to avoid
// churn (document.title may settle late; we accept the first real name we see).
const upsertedGames = new Set<string>();

// Serialize resolveAndPost: init, the 1s nav poll, and onProfilesChanged can all
// fire concurrently. Each run reads/writes module-scoped resolution state and
// awaits storage — left unguarded, two runs interleave and tear the TabProfile /
// seen-games writes. Chain them so only one runs at a time (errors swallowed so a
// single failure can't wedge the chain).
let resolveChain: Promise<void> = Promise.resolve();
function scheduleResolve(isNavigation: boolean): void {
	resolveChain = resolveChain.then(() => resolveAndPost(isNavigation)).catch(() => {});
}

// The empty per-tab context block — the shape posted before (or absent) a
// resolution. Deduped here so the `lastPayload` seed and `post()` share one
// literal; `postResolved()` overrides every field with computed values.
const EMPTY_CONTEXT = {
	profiles: [] as { id: string; name: string }[],
	activeProfileId: '',
	productId: null as string | null,
	slug: null as string | null,
	gameName: null as string | null,
	contextDefaultProfileId: '',
};

// The last full payload we posted — replayed verbatim when MAIN sends `hello`
// (handshake below). Seeded with assets + safe defaults so a `hello` that lands
// before the first resolution still gets the asset URLs.
let lastPayload: BridgePayload = {
	__padmonk: 'config',
	config: {},
	...assetUrls(),
	...EMPTY_CONTEXT,
};

/**
 * Post an asset-only payload (empty/standalone config) to MAIN. Used ONLY for
 * the proactive handshake post before storage is read — asset URLs don't depend
 * on storage, so MAIN can render with defaults until the first resolution lands.
 */
function post(config: Config | Record<string, never>): void {
	lastPayload = {
		__padmonk: 'config',
		config,
		...assetUrls(),
		...EMPTY_CONTEXT,
	};
	window.postMessage(lastPayload, '*');
}

/** Post the fully-resolved payload (config + profiles + context) to MAIN. */
function postResolved(): void {
	if (!pstate) return;
	const config = projectProfileConfig(pstate, activeProfileId);
	const profiles = pstate.profiles.map((p) => ({ id: p.id, name: p.name }));
	const gameName = productId ? (pstate.seenGames[productId]?.name ?? null) : null;
	const contextDefaultProfileId = productId
		? (pstate.gameDefaults[productId] ?? pstate.globalDefaultProfileId)
		: pstate.globalDefaultProfileId;
	lastPayload = {
		__padmonk: 'config',
		config,
		...assetUrls(),
		profiles,
		activeProfileId,
		productId,
		slug,
		gameName,
		contextDefaultProfileId,
	};
	window.postMessage(lastPayload, '*');
}

/** Best-effort auto-load toast: posted on a NAVIGATION into a game default. */
function postToast(profileName: string, gameName: string): void {
	window.postMessage({ __padmonk: 'toast', kind: 'profile-loaded', profileName, gameName }, '*');
}

// HANDSHAKE (fixes the dynamic-import race): the MAIN-world inject coordinator
// registers its `message` listener asynchronously (CRXJS loads it via dynamic
// import), so a single proactive post can land before MAIN is listening — and
// every asset URL silently goes missing. So we BOTH (a) post proactively, and
// (b) reply to MAIN's `hello` pings with the latest payload. Asset URLs do not
// depend on storage, so we post them immediately too (before readProfilesState).
post({});

function isAction(v: unknown): v is Action {
	if (!v || typeof v !== 'object') return false;
	const a = v as Record<string, unknown>;
	if (a.t === 'b') return typeof a.i === 'number' && Number.isInteger(a.i);
	if (a.t === 'a') return (a.a === 0 || a.a === 1) && (a.v === -1 || a.v === 1);
	return false;
}

/** Persist a durable state mutation: update memory, repost, write-through. */
function persistDurable(next: ProfilesState): void {
	pstate = next;
	postResolved();
	void writeProfilesState(next);
	// onProfilesChanged → resolveAndPost will also fire; idempotent.
}

/**
 * The core per-tab resolution routine. Called on init, on navigation, and on any
 * durable profiles-store change. Resolves which profile THIS tab should use,
 * persists the resolved TabProfile to storage.session, captures the game name
 * into the durable seen-games registry, and posts the resolved payload to MAIN.
 *
 * `isNavigation` distinguishes a nav from init/store so the auto-load toast only
 * fires when we NAVIGATE into a new game (not on initial load or a store edit).
 */
async function resolveAndPost(isNavigation: boolean): Promise<void> {
	const ref = gameRefFromPath(location.pathname);
	const nextProductId = ref?.productId ?? null;
	const nextSlug = ref?.slug ?? null;
	const enteredNewGame = isNavigation && nextProductId != null && nextProductId !== productId;

	const fresh = await readProfilesState();

	// This tab's session override only counts when it was written for THIS game
	// context; a navigation to a different game discards a stale override.
	const tab = tabId != null ? await readTabProfile(tabId) : null;
	const override = tab && tab.productId === nextProductId ? tab.profileId : null;
	const resolvedId = resolveProfileId(fresh, nextProductId, override);

	// Publish the freshly-resolved context to module scope. Everything below this
	// point uses the LOCALS (nextProductId/nextSlug/resolvedId), not the module
	// vars, so a concurrent set-active-profile can't tear this run's writes.
	pstate = fresh;
	productId = nextProductId;
	slug = nextSlug;
	activeProfileId = resolvedId;

	// Persist the resolved record so the popup/service worker can read this tab's
	// active profile (no-op when tabId is null / session area is unavailable).
	if (tabId != null) {
		await writeTabProfile(tabId, {
			productId: nextProductId,
			slug: nextSlug,
			profileId: resolvedId,
		});
	}

	// Seen-games (durable label registry). Capture the human name once per game
	// per load; only write when it actually differs from what we already stored.
	if (nextProductId && !upsertedGames.has(nextProductId)) {
		// Display name may be a slug fallback; titleName is '' unless a REAL document
		// title was captured (empty slug ⇒ boilerplate/empty titles return '').
		const name = gameNameFromTitle(document.title, nextSlug ?? '');
		const titleName = gameNameFromTitle(document.title, '');
		if (name) {
			// Merge onto the FRESHEST state, not the possibly-stale module pstate: a
			// concurrent durable save (save-as-default / set-enabled) may have landed.
			// upsertSeenGame only touches seenGames, so merging preserves that save.
			const freshNow = await readProfilesState();
			if (name !== freshNow.seenGames[nextProductId]?.name) {
				const merged = upsertSeenGame(freshNow, nextProductId, {
					name,
					slug: nextSlug ?? '',
					lastSeen: Date.now(),
				});
				pstate = merged;
				await writeProfilesState(merged);
			}
			// Only LOCK once a real title settled; a slug-fallback entry stays retryable
			// so the durable name upgrades when the document title finally arrives.
			if (titleName !== '') upsertedGames.add(nextProductId);
		}
	}

	postResolved();

	// Auto-load toast: only when we just entered a game whose resolved profile
	// came from a per-game default. Best-effort; Phase 3 renders the toast UI.
	if (enteredNewGame && pstate.gameDefaults[nextProductId] === resolvedId) {
		const profileName = pstate.profiles.find((p) => p.id === resolvedId)?.name ?? '';
		const gameName = pstate.seenGames[nextProductId]?.name ?? gameNameFromTitle('', nextSlug ?? '');
		postToast(profileName, gameName);
	}
}

window.addEventListener('message', (e) => {
	if (e.source !== window) return;
	const d = e.data as {
		__padmonk?: string;
		enabled?: unknown;
		action?: unknown;
		inputId?: unknown;
		profileId?: unknown;
	} | null;
	if (!d) return;

	if (d.__padmonk === 'hello') {
		window.postMessage(lastPayload, '*');
		return;
	}
	if (d.__padmonk === 'open-options') {
		try {
			chrome.runtime?.sendMessage?.({ __padmonk: 'open-options' });
		} catch {
			/* service worker unavailable */
		}
		return;
	}

	// --- Phase 2 overlay seams (Phase 3 emits these) ------------------------
	if (d.__padmonk === 'set-active-profile' && typeof d.profileId === 'string') {
		// SESSION-LOCAL switch: this tab only, no durable write. If tabId is null
		// (no session store) we still update in-memory + repost so the switch is
		// felt within this page.
		if (!pstate) return;
		activeProfileId = d.profileId;
		if (tabId != null) {
			void writeTabProfile(tabId, { productId, slug, profileId: d.profileId });
		}
		postResolved();
		return;
	}
	if (d.__padmonk === 'save-as-default') {
		// DURABLE: link the active profile to this game (in a game) or set it as the
		// global default (off a game).
		if (!pstate) return;
		const next = productId
			? setGameDefault(pstate, productId, activeProfileId)
			: setGlobalDefault(pstate, activeProfileId);
		persistDurable(next);
		return;
	}

	// --- Phase 1 seams (popup/overlay) --------------------------------------
	if (d.__padmonk === 'set-enabled' && typeof d.enabled === 'boolean') {
		if (!pstate) return;
		persistDurable({ ...pstate, globals: { ...pstate.globals, enabled: d.enabled } });
		return;
	}
	if (d.__padmonk === 'bind' && typeof d.inputId === 'string' && isAction(d.action)) {
		if (!pstate) return;
		const active = pstate.profiles.find((p) => p.id === activeProfileId);
		if (!active) return;
		persistDurable(
			updateProfile(pstate, activeProfileId, {
				bindings: { ...active.bindings, [d.inputId]: { ...d.action } },
			}),
		);
		return;
	}
	if (d.__padmonk === 'unbind' && typeof d.inputId === 'string') {
		if (!pstate) return;
		const active = pstate.profiles.find((p) => p.id === activeProfileId);
		if (!active) return;
		const bindings = { ...active.bindings };
		delete bindings[d.inputId];
		persistDurable(updateProfile(pstate, activeProfileId, { bindings }));
	}
});

/**
 * Acquire this tab's id from the service worker (sender.tab.id is only knowable
 * there). Promise form, guarded: if chrome.runtime / sendMessage is unavailable
 * or the worker doesn't answer, tabId stays null and session reads/writes no-op
 * gracefully — resolution then just uses the global default.
 */
async function acquireTabId(): Promise<void> {
	try {
		const res = (await chrome.runtime?.sendMessage?.({ __padmonk: 'whoami' })) as
			| { tabId?: number | null }
			| undefined;
		tabId = typeof res?.tabId === 'number' ? res.tabId : null;
	} catch {
		tabId = null;
	}
}

// Initial load: learn our tabId first (so the resolved TabProfile can be keyed),
// then resolve + post. Either branch still resolves so MAIN gets a config.
void acquireTabId().then(
	() => scheduleResolve(false),
	() => scheduleResolve(false),
);

// Navigation watch: Xbox is an SPA and the bridge loads once. Poll the pathname
// (mirrors inject.ts's 1s URL poll) and re-resolve on a change.
let lastPath = location.pathname;
setInterval(() => {
	if (location.pathname === lastPath) return;
	lastPath = location.pathname;
	scheduleResolve(true);
}, 1000);

// Store-change watch: any Options/popup edit re-resolves this tab and re-posts.
// resolveAndPost reads fresh state itself, so we ignore the callback's argument.
onProfilesChanged(() => scheduleResolve(false));
