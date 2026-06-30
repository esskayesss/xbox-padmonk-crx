// Wire-format ("profile") layer for export/import.
//
// Internal `Config` stores RAW mapper constants (e.g. sensitivity 0.002–0.05).
// Those leak into exported files and look nothing like the intuitive values the
// UI shows. This layer converts the 4 aim fields to/from their UI DISPLAY values
// on export/import only — storage and `normalizeConfig` stay raw.
//
// Backwards compatibility: a profile is only treated as display-encoded when it
// carries a finite `version >= 2` marker. Every pre-existing (unmarked) export
// imports byte-for-byte identically to today via the legacy `normalizeConfig`
// path. Detection is MARKER PRESENCE ONLY — raw and display ranges overlap, so
// value-range heuristics would corrupt data.

import { AIM_CONTROLS, type AimSettingKey, aimControlFor } from './aim-settings';
import { normalizeConfig } from './config';
import {
	type Globals,
	type ProfilesState,
	type SeenGame,
	globalCollision,
	normalizeProfilesState,
} from './profiles';
import type { Bindings, Config } from './types';

export const PROFILE_VERSION = 2;

const AIM_KEYS: readonly AimSettingKey[] = AIM_CONTROLS.map((c) => c.key);

/**
 * Export wire format: the `Config` shape, but with the 4 aim fields holding
 * DISPLAY values (clean integers) and an added `version` marker.
 */
export type ProfileExport = Omit<Config, 'sensitivity' | 'smoothing' | 'aimMin' | 'aimCurve'> & {
	version: number;
	sensitivity: number;
	smoothing: number;
	aimMin: number;
	aimCurve: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

/** Convert internal config -> display-encoded profile for export. */
export function configToProfile(config: Config): ProfileExport {
	const profile = { ...config, version: PROFILE_VERSION } as ProfileExport;
	for (const key of AIM_KEYS) {
		profile[key] = encodeAim(key, config[key]);
	}
	return profile;
}

/**
 * Decode the 4 aim fields of a record IN PLACE: a present+finite display value
 * is converted back to its raw mapper constant; a missing / NaN field is deleted
 * so the downstream normalizer fills the default. Shared by the single-profile
 * (`profileToConfig`) and bundle (`bundleFromImport`) decode paths.
 */
function decodeAimFields(record: Record<string, unknown>): void {
	for (const key of AIM_KEYS) {
		const value = record[key];
		if (typeof value === 'number' && Number.isFinite(value)) {
			record[key] = aimControlFor(key).toConfig(value);
		} else {
			delete record[key];
		}
	}
}

/** Convert an imported profile (v2 display-encoded OR legacy raw) -> internal config. */
export function profileToConfig(raw: unknown): Config {
	// A profiles bundle is the wrong importer — surface an error instead of
	// silently returning a DEFAULT config (the bundle path is `bundleFromImport`).
	if (isRecord(raw) && raw.kind === 'padmonk-bundle') {
		throw new Error('This is a profiles bundle — use Import profiles');
	}
	if (
		isRecord(raw) &&
		typeof raw.version === 'number' &&
		Number.isFinite(raw.version) &&
		raw.version >= 2
	) {
		// v2 display-encoded profile: convert present+finite aim fields back to raw.
		const { version: _version, ...rest } = raw;
		const converted: Record<string, unknown> = { ...rest };
		decodeAimFields(converted);
		return normalizeConfig(converted);
	}
	// Legacy / unmarked / garbage: EXACT current behavior.
	return normalizeConfig(raw);
}

// ---------------------------------------------------------------------------
// Multi-profile "bundle" wire format (export/import the WHOLE ProfilesState).
//
// The single-profile format above moves one Config across the wire. A bundle
// moves the entire store — every profile plus the globals, defaults, game
// mappings, and seen-games registry — so a user can back up or transfer their
// full padmonk setup in one file.
//
// Two disciplines, mirrored from the single-profile layer:
//   1. DISPLAY-ENCODE the 4 aim fields per profile (same `toDisplay`/`toConfig`
//      round-trip), so exported numbers are the clean UI values, not raw mapper
//      constants.
//   2. A back-compat MARKER (`kind` + `version`) gates import. A file is only
//      treated as a bundle when it is explicitly marked; anything else throws so
//      the caller can report an "invalid bundle" error rather than silently
//      corrupting the store.
//
// Safety: a recognized-but-garbage bundle can NEVER corrupt the store — it is
// reassembled into a raw ProfilesState shape and run through
// `normalizeProfilesState`, which enforces every store invariant (>= 1 profile,
// unique ids/names, clamped numerics, pruned dangling defaults).
// ---------------------------------------------------------------------------

/** Bundle schema marker; bump on a breaking bundle-shape change. */
export const BUNDLE_VERSION = 1;

/** A single profile inside a bundle: like Profile but aim fields DISPLAY-encoded. */
export interface BundleProfile {
	/** Optional stable id (normalize regenerates on absence/collision). */
	id?: string;
	name: string;
	bindings: Bindings;
	/** DISPLAY-encoded aim fields (clean UI integers, decoded on import). */
	sensitivity: number;
	smoothing: number;
	aimMin: number;
	aimCurve: number;
	invertY: boolean;
	lockPointerOnClick: boolean;
}

/**
 * Export wire format for the whole store. Carries a `kind` discriminator + a
 * finite `version` marker so `bundleFromImport` can recognize it unambiguously
 * (range heuristics are never used — they would be ambiguous).
 */
export interface ProfileBundle {
	version: number;
	kind: 'padmonk-bundle';
	profiles: BundleProfile[];
	globals: Globals;
	globalDefaultProfileId: string;
	gameDefaults: Record<string, string>;
	seenGames: Record<string, SeenGame>;
}

/** Display-encode one raw aim value exactly like `configToProfile`. */
function encodeAim(key: AimSettingKey, raw: number): number {
	const c = aimControlFor(key);
	return Number(c.toDisplay(raw).toFixed(c.dp));
}

/**
 * Serialize an entire ProfilesState into a display-encoded, marked bundle. Each
 * profile's 4 aim fields are display-encoded; everything else (name/id/bindings/
 * invertY/lockPointerOnClick + globals + defaults + game mappings + seen games)
 * is carried verbatim.
 */
export function profilesToBundle(state: ProfilesState): ProfileBundle {
	return {
		version: BUNDLE_VERSION,
		kind: 'padmonk-bundle',
		profiles: state.profiles.map((p) => ({
			id: p.id,
			name: p.name,
			bindings: p.bindings,
			sensitivity: encodeAim('sensitivity', p.sensitivity),
			smoothing: encodeAim('smoothing', p.smoothing),
			aimMin: encodeAim('aimMin', p.aimMin),
			aimCurve: encodeAim('aimCurve', p.aimCurve),
			invertY: p.invertY,
			lockPointerOnClick: p.lockPointerOnClick,
		})),
		globals: state.globals,
		globalDefaultProfileId: state.globalDefaultProfileId,
		gameDefaults: state.gameDefaults,
		seenGames: state.seenGames,
	};
}

/** True when `raw` is a marked v1+ bundle (marker presence only — see header). */
function isBundle(raw: unknown): raw is Record<string, unknown> {
	return (
		isRecord(raw) &&
		raw.kind === 'padmonk-bundle' &&
		typeof raw.version === 'number' &&
		Number.isFinite(raw.version) &&
		raw.version >= 1
	);
}

/**
 * Decode a marked bundle into a fully-normalized ProfilesState. Each profile's
 * present+finite aim fields are decoded back to raw mapper constants (missing /
 * NaN omitted so `normalizeProfilesState` fills the default); the reassembled
 * raw shape is then run through `normalizeProfilesState`, which enforces every
 * store invariant — so even a marked-but-garbage bundle yields a VALID state and
 * can never corrupt storage.
 *
 * Throws when `raw` is NOT a recognized bundle (single-profile export, `{}`,
 * `null`, …), so the UI can surface an "invalid bundle" error instead of
 * silently replacing the store.
 */
export function bundleFromImport(raw: unknown): ProfilesState {
	if (!isBundle(raw)) {
		throw new Error('Not a padmonk bundle');
	}
	// Resolve the imported globals' combo codes up front via the SAME path
	// normalizeProfilesState uses (normalizeConfig), so we can strip global-shortcut
	// collisions on the RAW profiles BELOW — before the SINGLE normalize pass. The
	// editor hard-blocks exactly these binds; an import must not smuggle them in.
	const g = isRecord(raw.globals) ? raw.globals : {};
	const gcfg = normalizeConfig({
		enabled: g.enabled,
		locale: g.locale,
		toggleCombo: g.toggleCombo,
		helpCombo: g.helpCombo,
	});
	const combos: Globals = {
		enabled: gcfg.enabled,
		locale: gcfg.locale,
		toggleCombo: gcfg.toggleCombo,
		helpCombo: gcfg.helpCombo,
	};

	const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
	const profiles = rawProfiles.map((p) => {
		const src = isRecord(p) ? p : {};
		const converted: Record<string, unknown> = { ...src };
		decodeAimFields(converted);
		// Strip global-shortcut collisions on the raw bindings (shared predicate).
		if (isRecord(converted.bindings)) {
			const bindings = { ...(converted.bindings as Record<string, unknown>) };
			for (const inputId of Object.keys(bindings)) {
				if (globalCollision(combos, inputId)) delete bindings[inputId];
			}
			converted.bindings = bindings;
		}
		return converted;
	});

	// One normalize pass: garbage-safety guarantee (≥ 1 profile, unique ids/names,
	// clamped numerics, pruned dangling defaults) still holds.
	return normalizeProfilesState({
		profiles,
		globals: raw.globals,
		globalDefaultProfileId: raw.globalDefaultProfileId,
		gameDefaults: raw.gameDefaults,
		seenGames: raw.seenGames,
	});
}
