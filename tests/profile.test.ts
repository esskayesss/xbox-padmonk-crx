import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/core/config';
import { configToProfile, PROFILE_VERSION, profileToConfig } from '../src/core/profile';

describe('configToProfile', () => {
	it('encodes default aim fields as clean display integers + version marker', () => {
		const p = configToProfile(DEFAULT_CONFIG);
		expect(p.version).toBe(PROFILE_VERSION);
		expect(p.version).toBe(2);
		expect(p.sensitivity).toBe(80);
		expect(p.smoothing).toBe(12);
		expect(p.aimMin).toBe(12);
		expect(p.aimCurve).toBe(25);
		// non-aim fields carried through unchanged
		expect(p.enabled).toBe(DEFAULT_CONFIG.enabled);
		expect(p.locale).toBe(DEFAULT_CONFIG.locale);
		expect(p.invertY).toBe(DEFAULT_CONFIG.invertY);
		expect(p.lockPointerOnClick).toBe(DEFAULT_CONFIG.lockPointerOnClick);
		expect(p.toggleCombo).toEqual(DEFAULT_CONFIG.toggleCombo);
		expect(p.helpCombo).toEqual(DEFAULT_CONFIG.helpCombo);
		expect(p.bindings).toEqual(DEFAULT_CONFIG.bindings);
	});
});

describe('profileToConfig round-trip', () => {
	it('configToProfile -> profileToConfig restores DEFAULT_CONFIG', () => {
		const back = profileToConfig(configToProfile(DEFAULT_CONFIG));
		// aim fields are lossless for defaults but guard float error
		expect(back.sensitivity).toBeCloseTo(DEFAULT_CONFIG.sensitivity, 10);
		expect(back.smoothing).toBeCloseTo(DEFAULT_CONFIG.smoothing, 10);
		expect(back.aimMin).toBeCloseTo(DEFAULT_CONFIG.aimMin, 10);
		expect(back.aimCurve).toBeCloseTo(DEFAULT_CONFIG.aimCurve, 10);
		// everything else exact
		const { sensitivity, smoothing, aimMin, aimCurve, ...restBack } = back;
		const {
			sensitivity: _s,
			smoothing: _sm,
			aimMin: _am,
			aimCurve: _ac,
			...restDefault
		} = DEFAULT_CONFIG;
		void sensitivity;
		void smoothing;
		void aimMin;
		void aimCurve;
		void _s;
		void _sm;
		void _am;
		void _ac;
		expect(restBack).toEqual(restDefault);
	});
});

describe('profileToConfig legacy / unmarked imports', () => {
	it('unmarked profile imports identically to normalizeConfig', () => {
		const raw = { sensitivity: 0.03, smoothing: 0.12 };
		expect(profileToConfig(raw)).toEqual(normalizeConfig(raw));
	});

	it('version < 2 takes the legacy path', () => {
		const raw = { version: 1, sensitivity: 0.03 };
		expect(profileToConfig(raw)).toEqual(normalizeConfig(raw));
	});

	it('garbage inputs go legacy and never throw', () => {
		expect(profileToConfig(null)).toEqual(normalizeConfig(null));
		expect(profileToConfig('nope')).toEqual(normalizeConfig('nope'));
		expect(profileToConfig(undefined)).toEqual(normalizeConfig(undefined));
	});
});

describe('profileToConfig v2 display decoding', () => {
	it('clamps out-of-range display values via normalizeConfig', () => {
		const c = profileToConfig({ version: 2, sensitivity: 999 });
		// 999% display -> raw clamps to AIM_LIMITS.sensitivity.max
		expect(c.sensitivity).toBe(0.05);
	});

	it('fills missing aim fields from defaults', () => {
		const c = profileToConfig({ version: 2, sensitivity: 80 });
		expect(c.sensitivity).toBeCloseTo(0.0144, 10);
		expect(c.smoothing).toBe(DEFAULT_CONFIG.smoothing);
		expect(c.aimMin).toBe(DEFAULT_CONFIG.aimMin);
		expect(c.aimCurve).toBe(DEFAULT_CONFIG.aimCurve);
	});

	it('omits NaN aim fields so defaults apply (never feeds NaN to toConfig)', () => {
		const c = profileToConfig({ version: 2, sensitivity: NaN });
		expect(c.sensitivity).toBe(DEFAULT_CONFIG.sensitivity);
	});

	it('decodes a full v2 profile back to raw config', () => {
		const c = profileToConfig({
			version: 2,
			sensitivity: 80,
			smoothing: 12,
			aimMin: 12,
			aimCurve: 25,
		});
		expect(c.sensitivity).toBeCloseTo(0.0144, 10);
		expect(c.smoothing).toBeCloseTo(0.12, 10);
		expect(c.aimMin).toBeCloseTo(0.12, 10);
		expect(c.aimCurve).toBeCloseTo(0.75, 10);
	});
});
