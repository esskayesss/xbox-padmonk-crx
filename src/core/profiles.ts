// Profile store: data model + pure, framework-free helpers.
//
// This module is the FOUNDATIONAL contract for the "Bind Profiles" feature
// (see docs/plans/profiles-and-game-defaults.md §§2,3,6). It owns:
//   - the durable ProfilesState shape (key `profiles`),
//   - the ephemeral per-tab TabProfile shape (key `tab:${tabId}`),
//   - every pure transform over those shapes (normalize / resolve / mutate).
//
// Hard rules for this file:
//   - NO `chrome.*`, NO storage, NO Svelte, NO DOM. Pure logic only.
//   - Every mutator treats ProfilesState as IMMUTABLE — it returns a brand-new
//     state and never mutates its inputs. This keeps Svelte reactivity and the
//     `storage.onChanged` broadcast bus honest (a changed reference == a change).
//   - Every mutator re-runs `normalizeProfilesState` on its result so the store
//     invariants below can NEVER be violated, no matter how a caller composes
//     operations. The invariants are the contract other agents rely on.
//
// Store invariants (always true of a normalized ProfilesState):
//   - `profiles.length >= 1` (a "Default" is synthesized if a raw shape has none).
//   - Every profile `id` is a non-empty, unique string.
//   - Every profile `name` is trimmed, single-line, non-empty, <= MAX_NAME_LEN,
//     and unique across profiles (collisions get a numeric suffix).
//   - Per-profile numerics are clamped to AIM_LIMITS and bindings are well-formed
//     (we reuse config.ts's `normalizeConfig` so the cleaning logic can't drift).
//   - `globalDefaultProfileId` references an existing profile (else profiles[0]).
//   - `gameDefaults` values all reference existing profiles (dangling pruned).
//   - `version === SCHEMA_VERSION`.
//
// The reuse-`normalizeConfig` choice is deliberate: config.ts already owns the
// only correct definitions of "valid bindings" and "clamped aim", but keeps
// `normalizeBindings` / `normalizeCombo` private. Rather than replicate (and
// risk drift), we project a profile's fields into a throwaway `Config`, run it
// through `normalizeConfig`, and read the cleaned fields back out. Same for the
// global combos. This is the single defensive discipline for the whole feature.

import { DEFAULT_CONFIG, normalizeConfig } from './config';
import { CONTROLLER_ACTIONS, actionKey, buildDefaultBindings } from './controller-actions';
import type { Locale } from '../paraglide/runtime.js';
import type { Bindings, Combo, Config } from './types';

/** Schema marker persisted with the store; bump on a breaking shape change. */
export const SCHEMA_VERSION = 1;

/** Upper bound on a profile name (single line, trimmed, deduped). */
const MAX_NAME_LEN = 40;

/** A named bundle of binds + per-profile aim/behavior. */
export interface Profile {
	/** Stable, unique, non-empty id (generated when missing). */
	id: string;
	/** Display name: trimmed, single-line, non-empty, <= MAX_NAME_LEN, unique. */
	name: string;
	/** input id -> action (validated via the same path config.ts uses). */
	bindings: Bindings;
	/** Mouse pixels -> right-stick deflection (clamped to AIM_LIMITS). */
	sensitivity: number;
	/** Right-stick smoothing (clamped to AIM_LIMITS). */
	smoothing: number;
	/** Minimum non-zero stick output (clamped to AIM_LIMITS). */
	aimMin: number;
	/** Aim response curve (clamped to AIM_LIMITS). */
	aimCurve: number;
	invertY: boolean;
	lockPointerOnClick: boolean;
	/** Creation timestamp (ms epoch); finite. */
	createdAt: number;
	/** Last-mutation timestamp (ms epoch); finite. */
	updatedAt: number;
}

/**
 * Settings that are global, not per-profile (see plan §3.1). These ride
 * alongside profiles in the durable store and are projected into a full Config
 * together with the active profile by `projectProfileConfig`.
 */
export interface Globals {
	enabled: boolean;
	locale: Locale;
	toggleCombo: Combo;
	helpCombo: Combo;
}

/** A label registry entry: the human title last seen for a product id. */
export interface SeenGame {
	name: string;
	slug: string;
	/** Last-seen timestamp (ms epoch); finite. */
	lastSeen: number;
}

/** The durable store persisted under the `profiles` key. */
export interface ProfilesState {
	/** Schema marker; always SCHEMA_VERSION after normalization. */
	version: number;
	/** Non-empty list of profiles. */
	profiles: Profile[];
	/** Fallback profile id when no per-game default applies. */
	globalDefaultProfileId: string;
	/** productId -> profileId. Dangling values are pruned on normalize. */
	gameDefaults: Record<string, string>;
	/** productId -> label registry entry. */
	seenGames: Record<string, SeenGame>;
	/** Global (non-per-profile) settings. */
	globals: Globals;
}

/**
 * The ephemeral per-tab record kept in `chrome.storage.session` under
 * `tab:${tabId}`. Defined here (not in a chrome-aware module) so it stays a
 * pure shape other layers can import without pulling in storage code.
 */
export interface TabProfile {
	productId: string | null;
	slug: string | null;
	profileId: string;
}

/** The kinds of issue `validateBindPlan` / `inProfileConflict` can surface. */
export type BindIssueKind = 'in-profile' | 'global-collision' | 'unmapped';

/**
 * A typed binding issue. Which fields are set depends on `kind`:
 *   - 'global-collision': `inputId` + `comboKind` (blocking at save time).
 *   - 'unmapped':         `actionKey` (non-blocking warning at save time).
 *   - 'in-profile':       `inputId` + `currentActionKey` (produced at EDIT time
 *                          by `inProfileConflict`, NOT by `validateBindPlan`).
 */
export interface BindIssue {
	kind: BindIssueKind;
	inputId?: string;
	actionKey?: string;
	currentActionKey?: string;
	comboKind?: 'toggle' | 'help';
	message?: string;
}

// ---------------------------------------------------------------------------
// Internal pure utilities
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

/** Coerce to a finite number, else a fallback. */
function finiteNum(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Generate a short, dependency-free, collision-resistant id. Timestamp (base36)
 * plus random suffix is plenty unique for a handful of local profiles; uniqueness
 * is additionally enforced against the live set in `normalizeProfilesState`.
 */
function genId(): string {
	return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sanitize a profile name: collapse all whitespace (incl. newlines) to single
 * spaces, trim, fall back to "Profile" when empty, and bound the length. This is
 * the single-line / non-empty / bounded half of the name invariant; the
 * uniqueness half is enforced separately by `dedupeName` (which needs the set of
 * names already taken).
 */
function sanitizeName(raw: unknown, fallback = 'Profile'): string {
	if (typeof raw !== 'string') return fallback;
	const single = raw.replace(/\s+/g, ' ').trim();
	if (single.length === 0) return fallback;
	return single.slice(0, MAX_NAME_LEN);
}

/**
 * Make `name` unique against `taken` by appending " 2", " 3", … The base is
 * trimmed if needed so the suffixed result still respects MAX_NAME_LEN.
 */
function dedupeName(name: string, taken: Set<string>): string {
	if (!taken.has(name)) return name;
	let i = 2;
	for (;;) {
		const suffix = ` ${i}`;
		const base =
			name.length + suffix.length <= MAX_NAME_LEN
				? name
				: name.slice(0, MAX_NAME_LEN - suffix.length);
		const candidate = `${base}${suffix}`;
		if (!taken.has(candidate)) return candidate;
		i++;
	}
}

/**
 * Clean the per-profile fields (bindings + aim + behavior booleans) by routing
 * them through config.ts's `normalizeConfig`. We hand it ONLY the per-profile
 * fields; the global fields it fills in (enabled/locale/combos) are defaults we
 * discard here. This reuses the one true binding-validation + aim-clamping path.
 */
function normalizeProfileFields(
	src: Record<string, unknown>,
): Pick<
	Profile,
	| 'bindings'
	| 'sensitivity'
	| 'smoothing'
	| 'aimMin'
	| 'aimCurve'
	| 'invertY'
	| 'lockPointerOnClick'
> {
	const cfg = normalizeConfig({
		bindings: src.bindings,
		sensitivity: src.sensitivity,
		smoothing: src.smoothing,
		aimMin: src.aimMin,
		aimCurve: src.aimCurve,
		invertY: src.invertY,
		lockPointerOnClick: src.lockPointerOnClick,
	});
	return {
		bindings: cfg.bindings,
		sensitivity: cfg.sensitivity,
		smoothing: cfg.smoothing,
		aimMin: cfg.aimMin,
		aimCurve: cfg.aimCurve,
		invertY: cfg.invertY,
		lockPointerOnClick: cfg.lockPointerOnClick,
	};
}

/**
 * Normalize a single raw profile into a valid Profile EXCEPT for cross-profile
 * uniqueness (id + name), which can only be enforced against the whole set and
 * is handled by `normalizeProfilesState`.
 */
function normalizeProfile(raw: unknown, now: number): Profile {
	const src = isRecord(raw) ? raw : {};
	const id = typeof src.id === 'string' && src.id.trim().length > 0 ? src.id : genId();
	const createdAt = finiteNum(src.createdAt, now);
	return {
		id,
		name: sanitizeName(src.name),
		...normalizeProfileFields(src),
		createdAt,
		updatedAt: finiteNum(src.updatedAt, now),
	};
}

/** Synthesize the seed "Default" profile from DEFAULT_CONFIG. */
function defaultProfile(now: number): Profile {
	return {
		id: genId(),
		name: 'Default',
		bindings: buildDefaultBindings(),
		sensitivity: DEFAULT_CONFIG.sensitivity,
		smoothing: DEFAULT_CONFIG.smoothing,
		aimMin: DEFAULT_CONFIG.aimMin,
		aimCurve: DEFAULT_CONFIG.aimCurve,
		invertY: DEFAULT_CONFIG.invertY,
		lockPointerOnClick: DEFAULT_CONFIG.lockPointerOnClick,
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Normalize the global (non-per-profile) settings. We project them through
 * `normalizeConfig` too so the combos go through the same `normalizeCombo` logic
 * config.ts owns, and locale through `coerceLocale`.
 */
function normalizeGlobals(raw: unknown): Globals {
	const src = isRecord(raw) ? raw : {};
	const cfg = normalizeConfig({
		enabled: src.enabled,
		locale: src.locale,
		toggleCombo: src.toggleCombo,
		helpCombo: src.helpCombo,
	});
	return {
		enabled: cfg.enabled,
		locale: cfg.locale,
		toggleCombo: cfg.toggleCombo,
		helpCombo: cfg.helpCombo,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Defensively coerce any raw, untrusted shape into a valid ProfilesState that
 * satisfies every store invariant (see file header). Safe to call on anything:
 * `undefined`, a half-migrated blob, or output from another mutator.
 */
export function normalizeProfilesState(raw: unknown): ProfilesState {
	const src = isRecord(raw) ? raw : {};
	const now = Date.now();

	// Profiles: normalize each, guaranteeing >= 1 by synthesizing a Default.
	const rawProfiles = Array.isArray(src.profiles) ? src.profiles : [];
	const profiles = rawProfiles.map((p) => normalizeProfile(p, now));
	if (profiles.length === 0) profiles.push(defaultProfile(now));

	// Enforce unique ids (regenerate on any clash).
	const seenIds = new Set<string>();
	for (const p of profiles) {
		while (seenIds.has(p.id)) p.id = genId();
		seenIds.add(p.id);
	}

	// Enforce unique names (suffix on clash).
	const takenNames = new Set<string>();
	for (const p of profiles) {
		const unique = dedupeName(p.name, takenNames);
		p.name = unique;
		takenNames.add(unique);
	}

	const ids = seenIds;

	// globalDefaultProfileId must reference an existing profile.
	const globalDefaultProfileId =
		typeof src.globalDefaultProfileId === 'string' && ids.has(src.globalDefaultProfileId)
			? src.globalDefaultProfileId
			: profiles[0].id;

	// gameDefaults: keep keys as-is; prune entries whose value is not a live id.
	const gameDefaults: Record<string, string> = {};
	if (isRecord(src.gameDefaults)) {
		for (const [k, v] of Object.entries(src.gameDefaults)) {
			if (typeof v === 'string' && ids.has(v)) gameDefaults[k] = v;
		}
	}

	// seenGames: coerce each entry's fields; keys kept as-is.
	const seenGames: Record<string, SeenGame> = {};
	if (isRecord(src.seenGames)) {
		for (const [k, v] of Object.entries(src.seenGames)) {
			if (!isRecord(v)) continue;
			seenGames[k] = {
				name: typeof v.name === 'string' ? v.name : '',
				slug: typeof v.slug === 'string' ? v.slug : '',
				lastSeen: finiteNum(v.lastSeen, now),
			};
		}
	}

	return {
		version: SCHEMA_VERSION,
		profiles,
		globalDefaultProfileId,
		gameDefaults,
		seenGames,
		globals: normalizeGlobals(src.globals),
	};
}

/**
 * Merge the global settings with one named profile (falling back to profiles[0]
 * when the id is unknown) into a full Config for the mapper / render path. The
 * result is run through `normalizeConfig` for a final safety pass.
 */
export function projectProfileConfig(state: ProfilesState, profileId: string): Config {
	const profile = state.profiles.find((p) => p.id === profileId) ?? state.profiles[0];
	return normalizeConfig({
		enabled: state.globals.enabled,
		locale: state.globals.locale,
		sensitivity: profile.sensitivity,
		smoothing: profile.smoothing,
		aimMin: profile.aimMin,
		aimCurve: profile.aimCurve,
		invertY: profile.invertY,
		lockPointerOnClick: profile.lockPointerOnClick,
		toggleCombo: state.globals.toggleCombo,
		helpCombo: state.globals.helpCombo,
		bindings: profile.bindings,
	});
}

/**
 * Resolve which profile a tab should use. Precedence (plan §5):
 *   1. `sessionOverride` — this tab's overlay pick, if it names a live profile.
 *   2. `gameDefaults[productId]` — the per-game default, if productId is set and
 *      the mapping points at a live profile.
 *   3. `globalDefaultProfileId`.
 *   4. `profiles[0].id` — the last-resort floor (always exists, >= 1 profile).
 */
export function resolveProfileId(
	state: ProfilesState,
	productId: string | null,
	sessionOverride: string | null,
): string {
	const ids = new Set(state.profiles.map((p) => p.id));
	if (sessionOverride != null && ids.has(sessionOverride)) return sessionOverride;
	if (productId != null) {
		const mapped = state.gameDefaults[productId];
		if (mapped != null && ids.has(mapped)) return mapped;
	}
	if (ids.has(state.globalDefaultProfileId)) return state.globalDefaultProfileId;
	return state.profiles[0].id;
}

/**
 * Create a fresh, valid Profile with a new id and timestamps. `base` seeds the
 * per-profile fields (binds + aim + behavior); any id/name on `base` is ignored
 * (id is always fresh, name comes from `name`). The fields are cleaned through
 * the same normalization path everything else uses. Cross-profile name dedupe
 * happens when the profile is added to a state (see `addProfile`).
 */
export function createProfile(name: string, base?: Partial<Profile>): Profile {
	const now = Date.now();
	return {
		id: genId(),
		name: sanitizeName(name),
		...normalizeProfileFields({
			bindings: base?.bindings,
			sensitivity: base?.sensitivity,
			smoothing: base?.smoothing,
			aimMin: base?.aimMin,
			aimCurve: base?.aimCurve,
			invertY: base?.invertY,
			lockPointerOnClick: base?.lockPointerOnClick,
		}),
		createdAt: finiteNum(base?.createdAt, now),
		updatedAt: now,
	};
}

/** Append a profile and re-normalize (dedupes id/name, keeps invariants). */
export function addProfile(state: ProfilesState, profile: Profile): ProfilesState {
	return normalizeProfilesState({ ...state, profiles: [...state.profiles, profile] });
}

/**
 * Patch one profile's mutable fields immutably. Maps the profile list and, for
 * the profile whose id matches, shallow-merges `patch` over it and bumps
 * `updatedAt` to now; every other profile is left untouched. The result is run
 * through `normalizeProfilesState` so the patched fields are cleaned (bindings
 * validated, aim clamped, name deduped) — a caller can't smuggle a broken shape
 * in through a patch. An unknown id is a no-op: the state is returned normalized
 * but otherwise unchanged. This is the single generic mutator the popup/options/
 * bridge consumers route their per-profile edits through.
 */
export function updateProfile(
	state: ProfilesState,
	id: string,
	patch: Partial<
		Pick<
			Profile,
			| 'name'
			| 'bindings'
			| 'sensitivity'
			| 'smoothing'
			| 'aimMin'
			| 'aimCurve'
			| 'invertY'
			| 'lockPointerOnClick'
		>
	>,
): ProfilesState {
	const now = Date.now();
	const profiles = state.profiles.map((p) =>
		p.id === id ? { ...p, ...patch, updatedAt: now } : p,
	);
	return normalizeProfilesState({ ...state, profiles });
}

/** Rename a profile (no-op for unknown ids after normalize); bumps updatedAt. */
export function renameProfile(state: ProfilesState, id: string, name: string): ProfilesState {
	return updateProfile(state, id, { name });
}

/**
 * Duplicate a profile with a fresh id and the name "⟨name⟩ copy" (deduped by
 * normalize). No-op when the id is unknown.
 */
export function duplicateProfile(state: ProfilesState, id: string): ProfilesState {
	const src = state.profiles.find((p) => p.id === id);
	if (!src) return state;
	return addProfile(state, createProfile(`${src.name} copy`, src));
}

/**
 * Delete a profile. GUARD: refuses to delete the last profile (returns the state
 * unchanged) so the >= 1 invariant holds. Reassigns `globalDefaultProfileId` to
 * profiles[0] of the resulting list when it pointed at the deleted id, and
 * PRUNES any `gameDefaults` entries that pointed at the deleted id (so those
 * games fall through to the global default per §5). No-op when the id is unknown.
 */
export function deleteProfile(state: ProfilesState, id: string): ProfilesState {
	if (state.profiles.length <= 1) return state;
	if (!state.profiles.some((p) => p.id === id)) return state;
	const remaining = state.profiles.filter((p) => p.id !== id);
	const fallbackId = remaining[0].id;
	const globalDefaultProfileId =
		state.globalDefaultProfileId === id ? fallbackId : state.globalDefaultProfileId;
	// PRUNE gameDefaults pointing at the deleted id (don't reassign): resolution
	// then falls through to the global default per the §5 precedence model.
	const gameDefaults: Record<string, string> = {};
	for (const [k, v] of Object.entries(state.gameDefaults)) {
		if (v !== id) gameDefaults[k] = v;
	}
	return normalizeProfilesState({
		...state,
		profiles: remaining,
		globalDefaultProfileId,
		gameDefaults,
	});
}

/** Set the global default profile (normalize falls back if the id is unknown). */
export function setGlobalDefault(state: ProfilesState, profileId: string): ProfilesState {
	return normalizeProfilesState({ ...state, globalDefaultProfileId: profileId });
}

/**
 * Map a product id to a profile (normalize prunes it if profileId is unknown).
 */
export function setGameDefault(
	state: ProfilesState,
	productId: string,
	profileId: string,
): ProfilesState {
	return normalizeProfilesState({
		...state,
		gameDefaults: { ...state.gameDefaults, [productId]: profileId },
	});
}

/** Remove a per-game default (reverts that game to the global default). */
export function clearGameDefault(state: ProfilesState, productId: string): ProfilesState {
	const gameDefaults = { ...state.gameDefaults };
	delete gameDefaults[productId];
	return normalizeProfilesState({ ...state, gameDefaults });
}

/** Insert or update the label-registry entry for a product id. */
export function upsertSeenGame(
	state: ProfilesState,
	productId: string,
	game: SeenGame,
): ProfilesState {
	return normalizeProfilesState({
		...state,
		seenGames: { ...state.seenGames, [productId]: game },
	});
}

/**
 * Migrate a flat legacy Config into a ProfilesState: split the global fields
 * (enabled, locale, toggleCombo, helpCombo) out into `globals`, and carry the
 * per-profile fields (bindings + aim + invertY + lockPointerOnClick) into a
 * single "Default" profile set as the global default. Empty gameDefaults /
 * seenGames. The raw config is cleaned through `normalizeConfig` first, so this
 * cannot lose or corrupt binds/aim.
 */
export function migrateLegacyConfig(rawConfig: unknown): ProfilesState {
	const cfg = normalizeConfig(rawConfig);
	const now = Date.now();
	const profile: Profile = {
		id: genId(),
		name: 'Default',
		bindings: cfg.bindings,
		sensitivity: cfg.sensitivity,
		smoothing: cfg.smoothing,
		aimMin: cfg.aimMin,
		aimCurve: cfg.aimCurve,
		invertY: cfg.invertY,
		lockPointerOnClick: cfg.lockPointerOnClick,
		createdAt: now,
		updatedAt: now,
	};
	return normalizeProfilesState({
		version: SCHEMA_VERSION,
		profiles: [profile],
		globalDefaultProfileId: profile.id,
		gameDefaults: {},
		seenGames: {},
		globals: {
			enabled: cfg.enabled,
			locale: cfg.locale,
			toggleCombo: cfg.toggleCombo,
			helpCombo: cfg.helpCombo,
		},
	});
}

/**
 * Validate a draft profile against draft globals at SAVE time (plan §6.2).
 * Returns typed issues for the two save-time concerns:
 *
 *   - 'global-collision' (BLOCKING): an inputId in the profile equals a global
 *     combo's `code`. The conservative rule is `inputId === combo.code` —
 *     modifiers are intentionally ignored, because a bare key press would fire
 *     BOTH the bind and the global shortcut (double-trigger). Mouse/Wheel input
 *     ids can never equal a keyboard combo code, so they're naturally excluded.
 *     One issue per offending combo (`comboKind: 'toggle' | 'help'`).
 *
 *   - 'unmapped' (WARNING, non-blocking): a controller action in the registry
 *     has no input bound to it in the draft. Saving is still allowed — a user
 *     may intentionally leave a bind empty.
 *
 * NOTE: the third kind, 'in-profile', is NOT produced here. It is an EDIT-time
 * concern surfaced by `inProfileConflict` when the user assigns one inputId that
 * is already bound to a different action. Save-Global cross-profile validation is
 * the caller's job (loop the profiles, call this per-profile); the function only
 * needs the two drafts.
 */
export function validateBindPlan(draftGlobals: Globals, draftProfile: Profile): BindIssue[] {
	const issues: BindIssue[] = [];

	// Global-shortcut collisions (blocking).
	for (const inputId of Object.keys(draftProfile.bindings)) {
		if (inputId === draftGlobals.toggleCombo.code) {
			issues.push({ kind: 'global-collision', inputId, comboKind: 'toggle' });
		}
		if (inputId === draftGlobals.helpCombo.code) {
			issues.push({ kind: 'global-collision', inputId, comboKind: 'help' });
		}
	}

	// Unmapped registry actions (warning).
	const bound = new Set<string>();
	for (const action of Object.values(draftProfile.bindings)) bound.add(actionKey(action));
	for (const entry of CONTROLLER_ACTIONS) {
		const key = actionKey(entry.action);
		if (!bound.has(key)) issues.push({ kind: 'unmapped', actionKey: key });
	}

	return issues;
}

/**
 * EDIT-time helper for the in-profile reuse case (plan §6.2 rule 1): when the
 * user assigns `inputId` to `newActionKey`, report the currently-bound action if
 * `inputId` is already bound to a DIFFERENT action (so the UI can confirm the
 * reassignment), else null (the input is free or already drives this action).
 */
export function inProfileConflict(
	bindings: Bindings,
	inputId: string,
	newActionKey: string,
): { currentActionKey: string } | null {
	const current = bindings[inputId];
	if (current == null) return null;
	const currentActionKey = actionKey(current);
	return currentActionKey !== newActionKey ? { currentActionKey } : null;
}
