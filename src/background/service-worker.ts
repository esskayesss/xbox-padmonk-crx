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
// worker restart. (What's-new onInstalled gating is Phase 5.)
void setSessionAccessLevel();
void updateActionIconFromStorage();

chrome.runtime.onInstalled.addListener(() => {
	void setSessionAccessLevel();
	void updateActionIconFromStorage();
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
