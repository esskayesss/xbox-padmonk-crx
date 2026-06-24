import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AIM_CONTROLS } from '../src/core/aim-settings';
import {
	CONTROLLER_ACTIONS,
	GROUP_TITLES,
	INFO_GROUPS,
	groupsForOptions,
} from '../src/core/controller-actions';
import { baseLocale, localeName, locales, m, resolveUiLocale } from '../src/core/i18n';

// Locales as declared in project.inlang/settings.json (mirrored by the compiled
// runtime). The disk-parity tests iterate these to read messages/<locale>.json.
const ALL_LOCALES = locales as readonly string[];

function messagesDir(locale: string): string {
	return fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
}

function keysOf(locale: string): Set<string> {
	const raw = JSON.parse(readFileSync(messagesDir(locale), 'utf8')) as Record<string, unknown>;
	const keys = new Set(Object.keys(raw));
	keys.delete('$schema'); // structural, not a message
	return keys;
}

const isAutonym = (k: string): boolean => k.startsWith('lang_name_');

describe('message key parity', () => {
	const enKeys = keysOf(baseLocale);
	// The shared key surface every locale must carry: all en keys minus the
	// per-locale autonym keys (each file ships ONLY its own lang_name_<locale>).
	const sharedKeys = new Set([...enKeys].filter((k) => !isAutonym(k)));

	for (const locale of ALL_LOCALES) {
		it(`${locale}.json has exactly the en key set (autonym exception)`, () => {
			const expected = new Set([...sharedKeys, `lang_name_${locale}`]);
			const actual = keysOf(locale);
			expect([...actual].sort()).toEqual([...expected].sort());
		});
	}

	it('en.json contains the manifest-facing keys (Chrome _locales source)', () => {
		expect(enKeys.has('ext_name')).toBe(true);
		expect(enKeys.has('ext_description')).toBe(true);
		expect(enKeys.has('action_title')).toBe(true);
	});
});

describe('autonym coverage', () => {
	for (const locale of ALL_LOCALES) {
		it(`${locale}.json has a non-empty lang_name_${locale}`, () => {
			const raw = JSON.parse(readFileSync(messagesDir(locale), 'utf8')) as Record<string, unknown>;
			const value = raw[`lang_name_${locale}`];
			expect(typeof value).toBe('string');
			expect((value as string).length).toBeGreaterThan(0);
		});
	}
});

describe('dynamic registry keys resolve on the compiled m', () => {
	const has = (key: string): boolean => typeof (m as Record<string, unknown>)[key] === 'function';

	it('every aim-settings label + hint key exists', () => {
		for (const control of AIM_CONTROLS) {
			expect(has(control.label), `missing aim label ${control.label}`).toBe(true);
			expect(has(control.hint), `missing aim hint ${control.hint}`).toBe(true);
		}
	});

	it('every controller-action label key exists', () => {
		for (const action of CONTROLLER_ACTIONS) {
			expect(has(action.label), `missing action label ${action.label}`).toBe(true);
		}
	});

	it('every group title + info key exists', () => {
		for (const title of Object.values(GROUP_TITLES)) {
			expect(has(title), `missing group title ${title}`).toBe(true);
		}
		for (const group of INFO_GROUPS) {
			expect(has(group.title), `missing info title ${group.title}`).toBe(true);
			expect(has(group.info), `missing info text ${group.info}`).toBe(true);
		}
	});

	it('groupsForOptions resolves without throwing for the base locale', () => {
		expect(() => groupsForOptions(baseLocale)).not.toThrow();
		const groups = groupsForOptions(baseLocale);
		expect(groups.length).toBeGreaterThan(0);
		for (const g of groups) {
			expect(g.title.length).toBeGreaterThan(0);
		}
	});
});

describe('localeName guards hyphenated-key sanitization', () => {
	for (const locale of locales) {
		it(`localeName(${locale}) returns a real autonym, not the raw key`, () => {
			const name = localeName(locale);
			expect(typeof name).toBe('string');
			expect(name.length).toBeGreaterThan(0);
			// Paraglide preserves hyphenated keys via a string export name; if that
			// ever regressed, t() would echo the key "lang_name_pt-BR" verbatim.
			expect(name).not.toBe(`lang_name_${locale}`);
		});
	}
});

describe('resolveUiLocale', () => {
	it('matches exact supported tags', () => {
		expect(resolveUiLocale('en')).toBe('en');
		expect(resolveUiLocale('pt-BR')).toBe('pt-BR');
		expect(resolveUiLocale('zh-CN')).toBe('zh-CN');
	});

	it('falls back to the primary subtag', () => {
		expect(resolveUiLocale('en-US')).toBe('en');
		expect(resolveUiLocale('de-AT')).toBe('de');
		expect(resolveUiLocale('fr-CA')).toBe('fr');
	});

	it('is case-insensitive on region subtags', () => {
		expect(resolveUiLocale('pt-br')).toBe('pt-BR');
		expect(resolveUiLocale('ZH-cn')).toBe('zh-CN');
	});

	it('maps a foreign region tag to the single shipped variant of that language', () => {
		// We ship only zh-CN / pt-BR; a Traditional-Chinese or European-Portuguese
		// UI should land on the shipped variant rather than English.
		expect(resolveUiLocale('zh-TW')).toBe('zh-CN');
		expect(resolveUiLocale('zh-HK')).toBe('zh-CN');
		expect(resolveUiLocale('zh')).toBe('zh-CN');
		expect(resolveUiLocale('pt-PT')).toBe('pt-BR');
		expect(resolveUiLocale('pt')).toBe('pt-BR');
	});

	it('falls back to the base locale for unknown / empty input', () => {
		expect(resolveUiLocale('')).toBe(baseLocale);
		expect(resolveUiLocale('xx-YY')).toBe(baseLocale);
	});
});
