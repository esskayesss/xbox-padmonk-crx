import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/core/config';
import { SCHEMA_VERSION, migrateLegacyConfig } from '../src/core/profiles';

const CUSTOM_CONFIG = {
	enabled: false,
	locale: 'hi' as const,
	sensitivity: 0.03,
	smoothing: 0.4,
	aimMin: 0.2,
	aimCurve: 1.5,
	invertY: true,
	lockPointerOnClick: false,
	toggleCombo: { code: 'KeyP', ctrl: true, alt: false, shift: false, meta: false },
	helpCombo: { code: 'KeyH', ctrl: false, alt: true, shift: false, meta: false },
	bindings: { KeyJ: { t: 'b', i: 3 } },
};

describe('migrateLegacyConfig structure', () => {
	it('yields exactly one "Default" profile set as the global default', () => {
		for (const cfg of [DEFAULT_CONFIG, CUSTOM_CONFIG]) {
			const s = migrateLegacyConfig(cfg);
			expect(s.profiles.length).toBe(1);
			expect(s.profiles[0].name).toBe('Default');
			expect(s.globalDefaultProfileId).toBe(s.profiles[0].id);
			expect(s.gameDefaults).toEqual({});
			expect(s.seenGames).toEqual({});
			expect(s.version).toBe(SCHEMA_VERSION);
		}
	});
});

describe('migrateLegacyConfig has no binding/aim loss', () => {
	it('carries bindings deep-equal to normalizeConfig(input)', () => {
		const s = migrateLegacyConfig(CUSTOM_CONFIG);
		expect(s.profiles[0].bindings).toEqual(normalizeConfig(CUSTOM_CONFIG).bindings);
	});

	it('preserves aim numerics + invertY + lockPointerOnClick', () => {
		const ref = normalizeConfig(CUSTOM_CONFIG);
		const p = migrateLegacyConfig(CUSTOM_CONFIG).profiles[0];
		expect(p.sensitivity).toBe(ref.sensitivity);
		expect(p.smoothing).toBe(ref.smoothing);
		expect(p.aimMin).toBe(ref.aimMin);
		expect(p.aimCurve).toBe(ref.aimCurve);
		expect(p.invertY).toBe(ref.invertY);
		expect(p.lockPointerOnClick).toBe(ref.lockPointerOnClick);
	});

	it('splits globals (enabled/locale/toggleCombo/helpCombo) correctly', () => {
		const ref = normalizeConfig(CUSTOM_CONFIG);
		const g = migrateLegacyConfig(CUSTOM_CONFIG).globals;
		expect(g.enabled).toBe(ref.enabled);
		expect(g.locale).toBe(ref.locale);
		expect(g.toggleCombo).toEqual(ref.toggleCombo);
		expect(g.helpCombo).toEqual(ref.helpCombo);
	});
});

describe('migrateLegacyConfig defensive', () => {
	it('still yields a valid single-Default state from garbage/partial input', () => {
		for (const raw of [null, undefined, 'nope', 42, {}, { sensitivity: 0.03 }]) {
			const s = migrateLegacyConfig(raw);
			expect(s.profiles.length).toBe(1);
			expect(s.profiles[0].name).toBe('Default');
			expect(s.globalDefaultProfileId).toBe(s.profiles[0].id);
			expect(s.version).toBe(SCHEMA_VERSION);
		}
	});
});
