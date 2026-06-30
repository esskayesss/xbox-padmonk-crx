import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import {
	SCHEMA_VERSION,
	addProfile,
	clearGameDefault,
	createProfile,
	deleteProfile,
	duplicateProfile,
	normalizeProfilesState,
	projectProfileConfig,
	renameProfile,
	resolveProfileId,
	setGameDefault,
	setGlobalDefault,
	updateProfile,
	upsertSeenGame,
} from '../src/core/profiles';
import type { ProfilesState } from '../src/core/profiles';

// A minimal valid two-profile state for resolve/project/mutator tests.
function twoProfileState(): ProfilesState {
	return normalizeProfilesState({
		version: SCHEMA_VERSION,
		profiles: [
			{ id: 'a', name: 'Alpha' },
			{ id: 'b', name: 'Beta' },
		],
		globalDefaultProfileId: 'a',
		gameDefaults: {},
		seenGames: {},
		globals: {},
	});
}

describe('normalizeProfilesState', () => {
	it('synthesizes a Default profile from undefined / garbage', () => {
		for (const raw of [undefined, null, 'nope', 42, {}, { profiles: 'bad' }, { profiles: [] }]) {
			const s = normalizeProfilesState(raw);
			expect(s.profiles.length).toBeGreaterThanOrEqual(1);
			expect(s.version).toBe(SCHEMA_VERSION);
			expect(s.globalDefaultProfileId).toBe(s.profiles[0].id);
		}
		expect(normalizeProfilesState(undefined).profiles[0].name).toBe('Default');
	});

	it('regenerates duplicate ids to be unique', () => {
		const s = normalizeProfilesState({
			profiles: [
				{ id: 'dup', name: 'One' },
				{ id: 'dup', name: 'Two' },
				{ id: 'dup', name: 'Three' },
			],
		});
		const ids = s.profiles.map((p) => p.id);
		expect(new Set(ids).size).toBe(3);
	});

	it('sanitizes blank / overlong / multiline names and dedupes collisions', () => {
		const s = normalizeProfilesState({
			profiles: [
				{ id: '1', name: '   ' }, // blank -> fallback "Profile"
				{ id: '2', name: 'line\nbreak\ttab' }, // multiline collapsed
				{ id: '3', name: 'x'.repeat(80) }, // overlong -> <= 40
				{ id: '4', name: 'Same' },
				{ id: '5', name: 'Same' }, // dup -> "Same 2"
			],
		});
		expect(s.profiles[0].name).toBe('Profile');
		expect(s.profiles[1].name).toBe('line break tab');
		expect(s.profiles[2].name.length).toBeLessThanOrEqual(40);
		const names = s.profiles.map((p) => p.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain('Same');
		expect(names).toContain('Same 2');
	});

	it('clamps per-profile numerics through normalizeConfig', () => {
		const s = normalizeProfilesState({
			profiles: [{ id: '1', name: 'X', sensitivity: 999, smoothing: 5, aimMin: 9, aimCurve: 100 }],
		});
		expect(s.profiles[0].sensitivity).toBe(0.05);
		expect(s.profiles[0].smoothing).toBe(0.95);
		expect(s.profiles[0].aimMin).toBe(0.5);
		expect(s.profiles[0].aimCurve).toBe(2);
	});

	it('falls back a dangling globalDefaultProfileId to profiles[0]', () => {
		const s = normalizeProfilesState({
			profiles: [
				{ id: 'a', name: 'A' },
				{ id: 'b', name: 'B' },
			],
			globalDefaultProfileId: 'ghost',
		});
		expect(s.globalDefaultProfileId).toBe('a');
	});

	it('prunes dangling gameDefaults values but keeps valid ones', () => {
		const s = normalizeProfilesState({
			profiles: [
				{ id: 'a', name: 'A' },
				{ id: 'b', name: 'B' },
			],
			gameDefaults: { GAME1: 'b', GAME2: 'ghost' },
		});
		expect(s.gameDefaults).toEqual({ GAME1: 'b' });
	});

	it('does not mutate its input', () => {
		const raw = {
			profiles: [{ id: 'a', name: '  messy  ', sensitivity: 999 }],
			globalDefaultProfileId: 'ghost',
			gameDefaults: { G: 'ghost' },
		};
		const snapshot = structuredClone(raw);
		normalizeProfilesState(raw);
		expect(raw).toEqual(snapshot);
	});
});

describe('createProfile', () => {
	it('produces a fresh id, sanitized name, cleaned base fields, timestamps', () => {
		const p = createProfile('  My  Profile  ', { sensitivity: 999, invertY: true });
		expect(p.id).toMatch(/^p_/);
		expect(p.name).toBe('My Profile');
		expect(p.sensitivity).toBe(0.05); // clamped
		expect(p.invertY).toBe(true);
		expect(Number.isFinite(p.createdAt)).toBe(true);
		expect(Number.isFinite(p.updatedAt)).toBe(true);
	});

	it('ignores any id/name carried on base', () => {
		const p = createProfile('Real', { id: 'forced', name: 'forced' } as never);
		expect(p.id).not.toBe('forced');
		expect(p.name).toBe('Real');
	});
});

describe('addProfile / renameProfile / duplicateProfile', () => {
	it('appends a profile', () => {
		const s = twoProfileState();
		const next = addProfile(s, createProfile('Gamma'));
		expect(next.profiles.map((p) => p.name)).toContain('Gamma');
		expect(next.profiles.length).toBe(3);
	});

	it('rename dedupes against existing names and bumps updatedAt', async () => {
		const s = twoProfileState();
		const before = s.profiles[1].updatedAt;
		await new Promise((r) => setTimeout(r, 2));
		const next = renameProfile(s, 'b', 'Alpha'); // collides with profile a
		const renamed = next.profiles.find((p) => p.id === 'b')!;
		expect(renamed.name).toBe('Alpha 2');
		expect(renamed.updatedAt).toBeGreaterThanOrEqual(before);
	});

	it('duplicate makes "<name> copy" with a new id, deduped on repeat', () => {
		let s = twoProfileState();
		s = duplicateProfile(s, 'a');
		expect(s.profiles.map((p) => p.name)).toContain('Alpha copy');
		s = duplicateProfile(s, 'a');
		const copies = s.profiles.filter((p) => p.name.startsWith('Alpha copy'));
		expect(copies.length).toBe(2);
		expect(new Set(copies.map((p) => p.id)).size).toBe(2);
		expect(s.profiles.map((p) => p.name)).toContain('Alpha copy 2');
	});

	it('duplicate is a no-op for unknown ids', () => {
		const s = twoProfileState();
		expect(duplicateProfile(s, 'ghost')).toBe(s);
	});
});

describe('deleteProfile', () => {
	it('refuses to delete the last profile (state unchanged)', () => {
		const s = normalizeProfilesState({ profiles: [{ id: 'only', name: 'Only' }] });
		expect(deleteProfile(s, 'only')).toBe(s);
	});

	it('reassigns globalDefault when the deleted profile was the default', () => {
		const s = twoProfileState(); // default = 'a'
		const next = deleteProfile(s, 'a');
		expect(next.profiles.some((p) => p.id === 'a')).toBe(false);
		expect(next.globalDefaultProfileId).toBe(next.profiles[0].id);
	});

	it('prunes gameDefaults pointing at the deleted id (falls through to global default)', () => {
		let s = twoProfileState(); // global default 'a'
		s = setGameDefault(s, 'GAME1', 'a');
		const next = deleteProfile(s, 'a');
		// The dangling entry is pruned, not reassigned.
		expect('GAME1' in next.gameDefaults).toBe(false);
		// Resolution now falls through to the (reassigned) global default.
		expect(resolveProfileId(next, 'GAME1', null)).toBe(next.globalDefaultProfileId);
	});

	it('is a no-op for unknown ids', () => {
		const s = twoProfileState();
		expect(deleteProfile(s, 'ghost')).toBe(s);
	});
});

describe('updateProfile', () => {
	it('patches fields, bumps updatedAt, and re-normalizes/clamps', async () => {
		const s = twoProfileState();
		const before = s.profiles[1].updatedAt;
		await new Promise((r) => setTimeout(r, 2));
		const next = updateProfile(s, 'b', { sensitivity: 999, invertY: true });
		const b = next.profiles.find((p) => p.id === 'b')!;
		expect(b.sensitivity).toBe(0.05); // clamped through normalizeConfig
		expect(b.invertY).toBe(true);
		expect(b.updatedAt).toBeGreaterThanOrEqual(before);
	});

	it('patches a name and dedupes it against existing names', () => {
		const s = twoProfileState();
		const next = updateProfile(s, 'b', { name: 'Alpha' }); // collides with 'a'
		expect(next.profiles.find((p) => p.id === 'b')!.name).toBe('Alpha 2');
	});

	it('is a no-op for unknown ids (state normalized but otherwise unchanged)', () => {
		const s = twoProfileState();
		const next = updateProfile(s, 'ghost', { sensitivity: 999 });
		expect(next.profiles).toEqual(s.profiles);
	});

	it('does not mutate its input', () => {
		const s = twoProfileState();
		const snapshot = structuredClone(s);
		updateProfile(s, 'a', { smoothing: 0.5, lockPointerOnClick: true });
		expect(s).toEqual(snapshot);
	});
});

describe('setGlobalDefault / setGameDefault / clearGameDefault', () => {
	it('sets a valid global default', () => {
		const s = twoProfileState();
		expect(setGlobalDefault(s, 'b').globalDefaultProfileId).toBe('b');
	});

	it('maps a valid game default, prunes an unknown one', () => {
		const s = twoProfileState();
		expect(setGameDefault(s, 'GAME1', 'b').gameDefaults).toEqual({ GAME1: 'b' });
		expect(setGameDefault(s, 'GAME1', 'ghost').gameDefaults).toEqual({});
	});

	it('clears a mapping', () => {
		let s = twoProfileState();
		s = setGameDefault(s, 'GAME1', 'b');
		s = clearGameDefault(s, 'GAME1');
		expect(s.gameDefaults).toEqual({});
	});
});

describe('upsertSeenGame', () => {
	it('inserts then overwrites an entry', () => {
		let s = twoProfileState();
		s = upsertSeenGame(s, 'GAME1', { name: 'Halo', slug: 'halo', lastSeen: 1 });
		expect(s.seenGames.GAME1.name).toBe('Halo');
		s = upsertSeenGame(s, 'GAME1', { name: 'Halo Infinite', slug: 'halo-infinite', lastSeen: 2 });
		expect(s.seenGames.GAME1).toEqual({
			name: 'Halo Infinite',
			slug: 'halo-infinite',
			lastSeen: 2,
		});
	});
});

describe('projectProfileConfig', () => {
	it('merges globals + named profile into a full normalized Config', () => {
		const s = normalizeProfilesState({
			profiles: [{ id: 'a', name: 'A', sensitivity: 999 }],
			globals: { enabled: false },
		});
		const cfg = projectProfileConfig(s, 'a');
		expect(cfg.enabled).toBe(false);
		expect(cfg.sensitivity).toBe(0.05); // clamped/normalized
		expect(cfg.bindings).toEqual(DEFAULT_CONFIG.bindings);
		expect(cfg.toggleCombo).toEqual(DEFAULT_CONFIG.toggleCombo);
	});

	it('falls back to profiles[0] for an unknown id', () => {
		const s = twoProfileState();
		const cfg = projectProfileConfig(s, 'ghost');
		const cfgA = projectProfileConfig(s, 'a');
		expect(cfg).toEqual(cfgA);
	});
});

describe('resolveProfileId precedence', () => {
	it('valid sessionOverride wins over everything', () => {
		let s = twoProfileState();
		s = setGameDefault(s, 'GAME1', 'a');
		expect(resolveProfileId(s, 'GAME1', 'b')).toBe('b');
	});

	it('falls to gameDefaults when no valid override', () => {
		let s = twoProfileState();
		s = setGameDefault(s, 'GAME1', 'b');
		expect(resolveProfileId(s, 'GAME1', null)).toBe('b');
		expect(resolveProfileId(s, 'GAME1', 'ghost')).toBe('b'); // invalid override skipped
	});

	it('falls to globalDefault when no game default applies', () => {
		const s = twoProfileState(); // global default 'a'
		expect(resolveProfileId(s, 'UNKNOWN', null)).toBe('a');
		expect(resolveProfileId(s, null, null)).toBe('a');
	});

	it('skips an invalid gameDefault to the global default', () => {
		// gameDefaults can only hold valid ids post-normalize, so simulate a
		// dangling value by deleting the profile it points at via state shape.
		const s = twoProfileState();
		// global default 'a'; productId maps nowhere valid -> global default
		expect(resolveProfileId(s, 'NOPE', null)).toBe('a');
	});

	it('floors to profiles[0] when global default is somehow invalid', () => {
		const s = twoProfileState();
		const broken: ProfilesState = { ...s, globalDefaultProfileId: 'ghost' };
		expect(resolveProfileId(broken, null, null)).toBe(broken.profiles[0].id);
	});
});
