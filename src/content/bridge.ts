// padmonk bridge — ISOLATED content-script world.
//
// Only this world has chrome.* APIs. The MAIN-world inject coordinator has NO
// chrome.* access (different JS world), so the bridge is the sole channel that:
//   1. reads the stored config (local-first, sync-fallback + migrate; see
//      shared/storage.ts for the rationale), and
//   2. resolves extension asset URLs via chrome.runtime.getURL and ships them to
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
	writeProfilesState,
} from '../shared/profiles-storage';
import { projectProfileConfig, resolveProfileId, updateProfile } from '../core/profiles';
import type { ProfilesState } from '../core/profiles';
import type { Action, Config } from '../core/types';

interface BridgePayload {
	__padmonk: 'config';
	config: Config | Record<string, never>;
	controllerUrl: string;
	iconUrl: string;
	bindIconBase: string;
	fontUrl: string;
}

/** chrome.runtime.getURL with a guard for when chrome.* is unavailable. */
function getURL(path: string): string {
	try {
		return chrome.runtime?.getURL?.(path) ?? '';
	} catch {
		return '';
	}
}

// Last config we posted — replayed when MAIN sends a `hello` (handshake below).
let lastConfig: Config | Record<string, never> = {};

/** Post config + freshly-resolved asset URLs to the MAIN world. */
function post(config: Config | Record<string, never>): void {
	lastConfig = config;
	const payload: BridgePayload = {
		__padmonk: 'config',
		config,
		controllerUrl: getURL('assets/xbox-controller.svg'),
		iconUrl: getURL('icons/padmonk.png'),
		bindIconBase: getURL('assets/bind-icons/'),
		// NEW (Bug 6): bundled font, no longer hotlinked from the xbox CDN.
		fontUrl: getURL('assets/fonts/bahnschrift.woff'),
	};
	window.postMessage(payload, '*');
}

// HANDSHAKE (fixes the dynamic-import race): the MAIN-world inject coordinator
// registers its `message` listener asynchronously (CRXJS loads it via dynamic
// import), so a single proactive post can land before MAIN is listening — and
// every asset URL silently goes missing. So we BOTH (a) post proactively, and
// (b) reply to MAIN's `hello` pings with the latest payload. Asset URLs do not
// depend on storage, so we post them immediately too (before readConfig).
post({});

function isAction(v: unknown): v is Action {
	if (!v || typeof v !== 'object') return false;
	const a = v as Record<string, unknown>;
	if (a.t === 'b') return typeof a.i === 'number' && Number.isInteger(a.i);
	if (a.t === 'a') return (a.a === 0 || a.a === 1) && (a.v === -1 || a.v === 1);
	return false;
}

// Latest durable state + the profile id this tab currently resolves to. Per-tab
// resolution (tabId + storage.session) is Phase 2; for now every tab resolves
// the GLOBAL DEFAULT via resolveProfileId(state, null, null).
let pstate: ProfilesState | null = null;
let activeProfileId = '';

/** Project the active profile to a Config and post it to MAIN. */
function postState(state: ProfilesState): void {
	activeProfileId = resolveProfileId(state, null, null);
	post(projectProfileConfig(state, activeProfileId));
}

/** Persist a new state, re-project + post, and keep module state in sync. */
function persistState(next: ProfilesState): void {
	pstate = next;
	postState(next);
	void writeProfilesState(next);
}

window.addEventListener('message', (e) => {
	if (e.source !== window) return;
	const d = e.data as {
		__padmonk?: string;
		enabled?: unknown;
		action?: unknown;
		inputId?: unknown;
	} | null;
	if (!d) return;
	if (d.__padmonk === 'hello') {
		post(lastConfig);
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
	if (d.__padmonk === 'set-enabled' && typeof d.enabled === 'boolean') {
		if (!pstate) return;
		persistState({ ...pstate, globals: { ...pstate.globals, enabled: d.enabled } });
		return;
	}
	if (d.__padmonk === 'bind' && typeof d.inputId === 'string' && isAction(d.action)) {
		if (!pstate) return;
		const active = pstate.profiles.find((p) => p.id === activeProfileId);
		if (!active) return;
		persistState(
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
		persistState(updateProfile(pstate, activeProfileId, { bindings }));
	}
});

// Initial load. readProfilesState handles local-first → sync-fallback (+ migrate)
// and always returns a normalized ProfilesState. On any failure keep the empty
// config so MAIN still has the asset URLs and renders with safe defaults.
readProfilesState()
	.then((state) => {
		pstate = state;
		postState(state);
	})
	.catch(() => post({}));

// Relay live state changes (popup/options write local; sync may also change).
// We re-post the full payload so MAIN's asset URLs stay fresh too. Per-tab
// resolution via tabId + storage.session is Phase 2.
onProfilesChanged((state) => {
	pstate = state;
	postState(state);
});
