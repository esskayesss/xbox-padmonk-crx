import {
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

// Open the advanced settings page on request (the binds overlay links here).
// openOptionsPage isn't exposed to content scripts, so the bridge relays here.
chrome.runtime.onMessage.addListener((msg) => {
	if (msg?.__padmonk === 'open-options') {
		void chrome.runtime.openOptionsPage();
	}
});
