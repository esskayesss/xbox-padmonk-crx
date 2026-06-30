import {
	clearTabProfile,
	onProfilesChanged,
	readProfilesState,
	setSessionAccessLevel,
} from '../shared/profiles-storage';

const COLORED_ICON = {
	16: 'icons/icon-16.png',
	32: 'icons/icon-32.png',
	48: 'icons/icon-48.png',
	128: 'icons/icon-128.png',
};

const DISABLED_ICON = {
	16: 'icons/icon-disabled-16.png',
	32: 'icons/icon-disabled-32.png',
	48: 'icons/icon-disabled-48.png',
	128: 'icons/icon-disabled-128.png',
};

async function setActionIcon(enabled: boolean): Promise<void> {
	await chrome.action.setIcon({ path: enabled ? COLORED_ICON : DISABLED_ICON });
	await chrome.action.setTitle({ title: enabled ? 'padmonk — ON' : 'padmonk — OFF' });
}

async function updateActionIconFromStorage(): Promise<void> {
	const state = await readProfilesState();
	await setActionIcon(state.globals.enabled);
}

// Grant content scripts (untrusted contexts) the ability to write
// chrome.storage.session, then sync the toolbar icon. Run on initial SW
// evaluation and on both lifecycle events so the access level survives a
// worker restart.
void setSessionAccessLevel();
void updateActionIconFromStorage();

// --- What's-new gating -----------------------------------------------------
// Built path of the programmatically-opened what's-new page. crxjs emits the
// rollup HTML input at dist/src/whatsnew/index.html (verified post-build), so
// the runtime URL mirrors the source layout.
const WHATS_NEW_PATH = 'src/whatsnew/index.html';
const LAST_WHATS_NEW_KEY = 'lastWhatsNewVersion';

/**
 * A bump is "meaningful" when MAJOR or MINOR changes (patch-only → false).
 * Defensive: a missing/garbage previous version is treated as meaningful so we
 * never silently swallow a first real update after a broken record.
 */
function isMeaningful(prev: string | undefined, current: string): boolean {
	const parse = (v: string | undefined): [number, number] | null => {
		if (typeof v !== 'string') return null;
		const parts = v.split('.');
		const major = Number(parts[0]);
		const minor = Number(parts[1] ?? 0);
		if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
		return [major, minor];
	};
	const p = parse(prev);
	const c = parse(current);
	// Garbage on either side → treat as meaningful (fail open).
	if (!p || !c) return true;
	return p[0] !== c[0] || p[1] !== c[1];
}

// onInstalled: keep the existing install-time wiring (session access level +
// toolbar icon) AND gate the what's-new tab. A fresh install only SEEDS
// lastWhatsNewVersion (no tab). A meaningful update opens the page once per
// version. chrome.tabs.create works for extension pages WITHOUT the `tabs`
// permission, so no manifest change. lastWhatsNewVersion is a standalone
// chrome.storage.local key, intentionally separate from the profiles store.
chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
	void setSessionAccessLevel();
	void updateActionIconFromStorage();
	void (async () => {
		try {
			const current = chrome.runtime.getManifest().version;
			if (reason === 'install') {
				await chrome.storage?.local?.set({ [LAST_WHATS_NEW_KEY]: current });
				return;
			}
			if (reason === 'update') {
				const stored = await chrome.storage?.local?.get(LAST_WHATS_NEW_KEY);
				const last = stored?.[LAST_WHATS_NEW_KEY];
				if (isMeaningful(previousVersion, current) && current !== last) {
					await chrome.tabs?.create?.({ url: chrome.runtime.getURL(WHATS_NEW_PATH) });
					await chrome.storage?.local?.set({ [LAST_WHATS_NEW_KEY]: current });
				}
			}
		} catch {
			/* chrome.* unavailable / storage failure — skip what's-new gating */
		}
	})();
});

chrome.runtime.onStartup.addListener(() => {
	void setSessionAccessLevel();
	void updateActionIconFromStorage();
});

onProfilesChanged((state) => void setActionIcon(state.globals.enabled));

// Content-script message relay. Two messages:
//   - 'open-options': openOptionsPage isn't exposed to content scripts, so the
//     bridge relays the request here.
//   - 'whoami': the bridge has no direct way to learn its own tabId (needed to
//     key chrome.storage.session). sender.tab.id is available here WITHOUT the
//     `tabs` permission, so we hand it back. Returning true keeps the response
//     channel open for the async sendResponse.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.__padmonk === 'open-options') {
		void chrome.runtime.openOptionsPage();
		return;
	}
	if (msg?.__padmonk === 'whoami') {
		sendResponse({ tabId: sender.tab?.id ?? null });
		return true;
	}
});

// Clean up a tab's ephemeral profile record when the tab closes. onRemoved +
// sender.tab.id both work WITHOUT the `tabs` permission, so no manifest change.
chrome.tabs.onRemoved.addListener((tabId) => void clearTabProfile(tabId));
