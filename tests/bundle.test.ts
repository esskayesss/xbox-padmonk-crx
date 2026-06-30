import { describe, expect, it } from 'vitest';
import {
	BUNDLE_VERSION,
	bundleFromImport,
	configToProfile,
	profilesToBundle,
} from '../src/core/profile';
import { DEFAULT_CONFIG } from '../src/core/config';
import { normalizeProfilesState, type ProfilesState } from '../src/core/profiles';

/** Build a realistic multi-profile state with custom aim, defaults, registries. */
function buildState(): ProfilesState {
	return normalizeProfilesState({
		profiles: [
			{
				id: 'pa',
				name: 'FPS',
				bindings: { KeyW: { t: 'a', a: 1, v: -1 }, Mouse0: { t: 'b', i: 7 } },
				// raw mapper constants (mid-range, survive a display round-trip)
				sensitivity: 0.0144,
				smoothing: 0.12,
				aimMin: 0.12,
				aimCurve: 0.75,
				invertY: true,
				lockPointerOnClick: false,
			},
			{
				id: 'pb',
				name: 'Racing',
				bindings: { KeyS: { t: 'a', a: 1, v: 1 } },
				sensitivity: 0.03,
				smoothing: 0.5,
				aimMin: 0.05,
				aimCurve: 1.0,
				invertY: false,
				lockPointerOnClick: true,
			},
			{
				id: 'pc',
				name: 'Default',
				bindings: { KeyA: { t: 'a', a: 0, v: -1 } },
				sensitivity: 0.02,
				smoothing: 0.2,
				aimMin: 0.1,
				aimCurve: 0.5,
				invertY: false,
				lockPointerOnClick: false,
			},
		],
		globalDefaultProfileId: 'pb',
		gameDefaults: { '9NCJSXWZTP88': 'pa', C17GQF31D617: 'pb' },
		seenGames: {
			'9NCJSXWZTP88': { name: 'Starfield', slug: 'starfield', lastSeen: 1700000000000 },
			C17GQF31D617: { name: 'Forza', slug: 'forza-horizon-5', lastSeen: 1700000001000 },
		},
		globals: {
			enabled: false,
			locale: 'hi',
			toggleCombo: { code: 'F7', ctrl: true, alt: false, shift: false, meta: false },
			helpCombo: { code: 'F10', ctrl: false, alt: true, shift: false, meta: false },
		},
	});
}

describe('profilesToBundle export shape', () => {
	it('is marked padmonk-bundle at BUNDLE_VERSION', () => {
		const bundle = profilesToBundle(buildState());
		expect(bundle.kind).toBe('padmonk-bundle');
		expect(bundle.version).toBe(BUNDLE_VERSION);
		expect(bundle.version).toBe(1);
		expect(bundle.profiles).toHaveLength(3);
	});

	it('display-encodes aim fields (clean UI integers, not raw constants)', () => {
		const state = buildState();
		const bundle = profilesToBundle(state);
		// FPS profile raw 0.0144 sensitivity -> 80% display, matching configToProfile.
		expect(bundle.profiles[0].sensitivity).toBe(80);
		expect(bundle.profiles[0].smoothing).toBe(12);
		expect(bundle.profiles[0].aimMin).toBe(12);
		expect(bundle.profiles[0].aimCurve).toBe(25);
	});
});

describe('bundle round-trip — no loss', () => {
	it('profilesToBundle -> bundleFromImport preserves the whole store', () => {
		const before = buildState();
		const after = bundleFromImport(profilesToBundle(before));

		expect(after.profiles).toHaveLength(before.profiles.length);

		for (let i = 0; i < before.profiles.length; i++) {
			const b = before.profiles[i];
			const a = after.profiles[i];
			expect(a.name).toBe(b.name);
			expect(a.bindings).toEqual(b.bindings);
			expect(a.invertY).toBe(b.invertY);
			expect(a.lockPointerOnClick).toBe(b.lockPointerOnClick);
			// aim numerics survive display rounding within tolerance
			expect(a.sensitivity).toBeCloseTo(b.sensitivity, 3);
			expect(a.smoothing).toBeCloseTo(b.smoothing, 3);
			expect(a.aimMin).toBeCloseTo(b.aimMin, 3);
			expect(a.aimCurve).toBeCloseTo(b.aimCurve, 3);
		}

		// Globals preserved.
		expect(after.globals.enabled).toBe(before.globals.enabled);
		expect(after.globals.locale).toBe(before.globals.locale);
		expect(after.globals.toggleCombo).toEqual(before.globals.toggleCombo);
		expect(after.globals.helpCombo).toEqual(before.globals.helpCombo);

		// Defaults + mappings + registry preserved.
		expect(after.gameDefaults).toEqual(before.gameDefaults);
		expect(after.seenGames).toEqual(before.seenGames);
		// globalDefaultProfileId preserved (or reconciled to a live id).
		expect(after.profiles.some((p) => p.id === after.globalDefaultProfileId)).toBe(true);
		expect(after.globalDefaultProfileId).toBe(before.globalDefaultProfileId);
	});
});

describe('bundleFromImport — marker gating', () => {
	it('throws on a single-profile export', () => {
		const single = configToProfile(DEFAULT_CONFIG);
		expect(() => bundleFromImport(single)).toThrow();
	});

	it('throws on {} and null', () => {
		expect(() => bundleFromImport({})).toThrow();
		expect(() => bundleFromImport(null)).toThrow();
	});

	it('throws on a bundle-shaped object without the marker', () => {
		expect(() => bundleFromImport({ profiles: [], globals: {} })).toThrow();
	});
});

describe('bundleFromImport — garbage safety', () => {
	it('a marked-but-partial bundle yields a valid normalized state without throwing', () => {
		const state = bundleFromImport({ kind: 'padmonk-bundle', version: 1 });
		// normalize synthesizes a Default when no profiles are present.
		expect(state.profiles.length).toBeGreaterThanOrEqual(1);
		expect(state.profiles.some((p) => p.id === state.globalDefaultProfileId)).toBe(true);
		expect(state.version).toBe(1);
	});

	it('a marked bundle with junk profiles still normalizes (no corruption)', () => {
		const state = bundleFromImport({
			kind: 'padmonk-bundle',
			version: 1,
			profiles: [{ name: '   ', sensitivity: 'nope' }, 42, null],
			globalDefaultProfileId: 'does-not-exist',
			gameDefaults: { GAME: 'dangling' },
		});
		expect(state.profiles.length).toBeGreaterThanOrEqual(1);
		// dangling default pruned, fallback reconciled to a live profile
		expect(state.profiles.some((p) => p.id === state.globalDefaultProfileId)).toBe(true);
		expect(state.gameDefaults).toEqual({});
	});
});
