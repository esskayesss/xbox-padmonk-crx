// User-facing aim controls and conversion to internal mapper constants.
// Internal values stay precise for mapper math; UI shows understandable values.

import { clamp } from './math';
import type { Config } from './types';

export type AimSettingKey = 'sensitivity' | 'smoothing' | 'aimMin' | 'aimCurve';

export type AimSettingControl = {
	key: AimSettingKey;
	/** i18n message key for the short control label (popup). */
	label: string;
	/** i18n message key for the short control hint (popup). */
	hint: string;
	min: number;
	max: number;
	step: number;
	dp: number;
	unit: string;
	fallback: number;
	toDisplay: (internal: number) => number;
	toConfig: (display: number) => number;
};

export const AIM_LIMITS = {
	sensitivity: { min: 0.002, max: 0.05 },
	smoothing: { min: 0, max: 0.95 },
	aimMin: { min: 0, max: 0.5 },
	aimCurve: { min: 0.25, max: 2 },
} as const;

const BASE_SENSITIVITY = 0.018;
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);
const snap = (v: number, c: AimSettingControl): number => {
	const clamped = clamp(v, c.min, c.max);
	const stepped = Math.round((clamped - c.min) / c.step) * c.step + c.min;
	return Number(stepped.toFixed(c.dp));
};

export const AIM_CONTROLS: readonly AimSettingControl[] = [
	{
		key: 'sensitivity',
		label: 'aim_sensitivity_label',
		hint: 'aim_sensitivity_hint',
		min: 10,
		max: 280,
		step: 5,
		dp: 0,
		unit: '%',
		fallback: 80,
		toDisplay: (v) =>
			(clamp(v, AIM_LIMITS.sensitivity.min, AIM_LIMITS.sensitivity.max) / BASE_SENSITIVITY) * 100,
		toConfig: (v) =>
			clamp((v / 100) * BASE_SENSITIVITY, AIM_LIMITS.sensitivity.min, AIM_LIMITS.sensitivity.max),
	},
	{
		key: 'smoothing',
		label: 'aim_smoothing_label',
		hint: 'aim_smoothing_hint',
		min: 0,
		max: 95,
		step: 1,
		dp: 0,
		unit: '%',
		fallback: 12,
		toDisplay: (v) => clamp(v, AIM_LIMITS.smoothing.min, AIM_LIMITS.smoothing.max) * 100,
		toConfig: (v) => clamp(v / 100, AIM_LIMITS.smoothing.min, AIM_LIMITS.smoothing.max),
	},
	{
		key: 'aimMin',
		label: 'aim_deadzone_label',
		hint: 'aim_deadzone_hint',
		min: 0,
		max: 50,
		step: 1,
		dp: 0,
		unit: '%',
		fallback: 12,
		toDisplay: (v) => clamp(v, AIM_LIMITS.aimMin.min, AIM_LIMITS.aimMin.max) * 100,
		toConfig: (v) => clamp(v / 100, AIM_LIMITS.aimMin.min, AIM_LIMITS.aimMin.max),
	},
	{
		key: 'aimCurve',
		label: 'aim_curve_label',
		hint: 'aim_curve_hint',
		min: -100,
		max: 75,
		step: 5,
		dp: 0,
		unit: '%',
		fallback: 25,
		toDisplay: (v) => (1 - clamp(v, AIM_LIMITS.aimCurve.min, AIM_LIMITS.aimCurve.max)) * 100,
		toConfig: (v) => clamp(1 - v / 100, AIM_LIMITS.aimCurve.min, AIM_LIMITS.aimCurve.max),
	},
] as const;

export function aimControlFor(key: AimSettingKey): AimSettingControl {
	return AIM_CONTROLS.find((c) => c.key === key)!;
}

export function aimDisplayValue(config: Config, key: AimSettingKey): number {
	return aimControlFor(key).toDisplay(config[key]);
}

/** Slider fill percentage (0–100) for the themed range track. */
export function aimDisplayFill(config: Config, key: AimSettingKey): number {
	const c = aimControlFor(key);
	const display = clamp(c.toDisplay(config[key]), c.min, c.max);
	return ((display - c.min) / (c.max - c.min)) * 100;
}

export function aimConfigValue(key: AimSettingKey, rawDisplay: string): number {
	const c = aimControlFor(key);
	const parsed = Number(rawDisplay.trim());
	const display = snap(finite(parsed, c.fallback), c);
	return c.toConfig(display);
}
