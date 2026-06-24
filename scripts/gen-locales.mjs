// Generate Chrome-native _locales/<code>/messages.json for every Inlang locale.
//
// Chrome's manifest-owned surfaces (extension name, description, toolbar tooltip
// on chrome://extensions and the Web Store card) are localized via the native
// _locales + __MSG_*__ mechanism, which is SEPARATE from the Paraglide runtime
// i18n used everywhere else in the UI. This script is the single bridge between
// the two: it sources the three manifest strings from messages/<locale>.json
// (the same source of truth as the rest of the app) and emits them in Chrome's
// messages.json shape.
//
// Mirrors src/paraglide/: _locales/ is gitignored and regenerated on prebuild,
// so messages/ stays the only source of truth. Run via `npm run gen:locales`
// (wired into prebuild + dev).

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const srcDir = resolve(root, 'messages');
const outDir = resolve(root, '_locales');

// Inlang locale code -> Chrome _locales dir code. Chrome uses an underscore
// before region subtags (pt_BR, zh_CN); plain languages are unchanged.
const CHROME_CODE = {
	'pt-BR': 'pt_BR',
	'zh-CN': 'zh_CN',
};

// The three manifest-facing keys, mapped from Inlang key -> Chrome message name.
const KEYS = {
	ext_name: 'extName',
	ext_description: 'extDescription',
	action_title: 'actionTitle',
};

rmSync(outDir, { recursive: true, force: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith('.json'));
let count = 0;

for (const file of files) {
	const locale = file.replace(/\.json$/, '');
	const src = JSON.parse(readFileSync(resolve(srcDir, file), 'utf8'));

	const messages = {};
	for (const [srcKey, msgName] of Object.entries(KEYS)) {
		const value = src[srcKey];
		if (typeof value !== 'string' || value.length === 0) {
			throw new Error(`messages/${file} missing required manifest key "${srcKey}"`);
		}
		messages[msgName] = { message: value };
	}

	const chromeCode = CHROME_CODE[locale] ?? locale;
	const dir = resolve(outDir, chromeCode);
	mkdirSync(dir, { recursive: true });
	writeFileSync(resolve(dir, 'messages.json'), JSON.stringify(messages, null, 2) + '\n');
	count++;
}

console.log(`gen-locales: wrote ${count} _locales/<code>/messages.json files`);
