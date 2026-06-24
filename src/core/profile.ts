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
import type { Config } from './types';

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
		const c = aimControlFor(key);
		const display = c.toDisplay(config[key]);
		profile[key] = Number(display.toFixed(c.dp));
	}
	return profile;
}

/** Convert an imported profile (v2 display-encoded OR legacy raw) -> internal config. */
export function profileToConfig(raw: unknown): Config {
	if (
		isRecord(raw) &&
		typeof raw.version === 'number' &&
		Number.isFinite(raw.version) &&
		raw.version >= 2
	) {
		// v2 display-encoded profile: convert present+finite aim fields back to raw.
		const { version: _version, ...rest } = raw;
		const converted: Record<string, unknown> = { ...rest };
		for (const key of AIM_KEYS) {
			const value = converted[key];
			if (typeof value === 'number' && Number.isFinite(value)) {
				converted[key] = aimControlFor(key).toConfig(value);
			} else {
				// Missing / NaN -> omit so normalizeConfig fills the default.
				delete converted[key];
			}
		}
		return normalizeConfig(converted);
	}
	// Legacy / unmarked / garbage: EXACT current behavior.
	return normalizeConfig(raw);
}
