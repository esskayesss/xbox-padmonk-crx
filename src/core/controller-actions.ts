// Single source of truth for every remappable control.
//
// The registry below drives:
//   - DEFAULT_CONFIG.bindings (via buildDefaultBindings)
//   - the options-page GROUPS (via groupsForOptions)
//   - the binds overlay
//   - the README bindings table
//
// Group titles and action labels are i18n message KEYS (stable identities that
// double as translation keys). groupsForOptions() resolves them to display text
// in the requested locale; the raw keys stay constant so grouping / fixed-set
// logic never drifts when a heading is translated.

import { BUTTON } from './constants';
import { baseLocale, t, type Locale, type MessageKey } from './i18n';
import type { Action, Bindings, ControllerAction, ControllerGroup } from './types';

/** Group identities (message keys), in render order. The Aim group is mouse-driven. */
export const GROUP_TITLES = {
	leftStick: 'group_left_stick',
	rightStick: 'group_right_stick',
	face: 'group_face',
	bumpersTriggers: 'group_bumpers_triggers',
	stickClicks: 'group_stick_clicks',
	menu: 'group_menu',
	dpad: 'group_dpad',
} as const;

/** Info groups that carry descriptive text but no remappable items. */
export const INFO_GROUPS: ReadonlyArray<{
	/** Group identity (message key). */
	title: string;
	/** Info text message key. */
	info: string;
}> = [
	{
		title: GROUP_TITLES.rightStick,
		info: 'group_right_stick_info',
	},
];

/**
 * Group titles whose inputs are fixed (not user-rebindable from the options
 * page). Keyed off the GROUP_TITLES constant — the same single source the
 * registry groups by — so this can't drift from a renamed heading.
 */
const FIXED_GROUP_TITLES = new Set<string>([GROUP_TITLES.leftStick]);

/** Stable serialization of an action's identity (button index, or axis+dir). */
export function actionKey(a: Action): string {
	return a.t === 'b' ? `b:${a.i}` : `a:${a.a}:${a.v}`;
}

/** True when two actions drive the same controller output. */
export function actionEq(a: Action | undefined, b: Action | undefined): boolean {
	return a != null && b != null && actionKey(a) === actionKey(b);
}

/**
 * The registry. Flattening defaultInputs -> action reproduces the legacy
 * DEFAULT_CONFIG.bindings exactly (see tests/registry.test.ts).
 */
export const CONTROLLER_ACTIONS: readonly ControllerAction[] = [
	// Movement — Left Stick
	{
		id: 'stick.left.up',
		label: 'action_stick_up',
		group: GROUP_TITLES.leftStick,
		action: { t: 'a', a: 1, v: -1 },
		icon: 'left-stick-up.svg',
		defaultInputs: ['KeyW'],
	},
	{
		id: 'stick.left.down',
		label: 'action_stick_down',
		group: GROUP_TITLES.leftStick,
		action: { t: 'a', a: 1, v: 1 },
		icon: 'left-stick-down.svg',
		defaultInputs: ['KeyS'],
	},
	{
		id: 'stick.left.left',
		label: 'action_stick_left',
		group: GROUP_TITLES.leftStick,
		action: { t: 'a', a: 0, v: -1 },
		icon: 'left-stick-left.svg',
		defaultInputs: ['KeyA'],
	},
	{
		id: 'stick.left.right',
		label: 'action_stick_right',
		group: GROUP_TITLES.leftStick,
		action: { t: 'a', a: 0, v: 1 },
		icon: 'left-stick-right.svg',
		defaultInputs: ['KeyD'],
	},

	// Face Buttons
	{
		id: 'btn.a',
		label: 'action_btn_a',
		group: GROUP_TITLES.face,
		action: { t: 'b', i: BUTTON.A },
		icon: 'a.svg',
		defaultInputs: ['Space'],
	},
	{
		id: 'btn.b',
		label: 'action_btn_b',
		group: GROUP_TITLES.face,
		action: { t: 'b', i: BUTTON.B },
		icon: 'b.svg',
		defaultInputs: ['ControlLeft'],
	},
	{
		id: 'btn.x',
		label: 'action_btn_x',
		group: GROUP_TITLES.face,
		action: { t: 'b', i: BUTTON.X },
		icon: 'x.svg',
		defaultInputs: ['KeyR'],
	},
	{
		id: 'btn.y',
		label: 'action_btn_y',
		group: GROUP_TITLES.face,
		action: { t: 'b', i: BUTTON.Y },
		icon: 'y.svg',
		defaultInputs: ['KeyF'],
	},

	// Bumpers & Triggers
	{
		id: 'btn.lb',
		label: 'action_btn_lb',
		group: GROUP_TITLES.bumpersTriggers,
		action: { t: 'b', i: BUTTON.LB },
		icon: 'left-bumper.svg',
		defaultInputs: ['KeyQ'],
	},
	{
		id: 'btn.rb',
		label: 'action_btn_rb',
		group: GROUP_TITLES.bumpersTriggers,
		action: { t: 'b', i: BUTTON.RB },
		icon: 'right-bumper.svg',
		defaultInputs: ['KeyE'],
	},
	{
		id: 'btn.lt',
		label: 'action_btn_lt',
		group: GROUP_TITLES.bumpersTriggers,
		action: { t: 'b', i: BUTTON.LT },
		icon: 'left-trigger.svg',
		defaultInputs: ['Mouse2'],
	},
	{
		id: 'btn.rt',
		label: 'action_btn_rt',
		group: GROUP_TITLES.bumpersTriggers,
		action: { t: 'b', i: BUTTON.RT },
		icon: 'right-trigger.svg',
		defaultInputs: ['Mouse0'],
	},

	// Stick Clicks
	{
		id: 'btn.l3',
		label: 'action_btn_l3',
		group: GROUP_TITLES.stickClicks,
		action: { t: 'b', i: BUTTON.L3 },
		icon: 'left-stick-press.svg',
		defaultInputs: ['ShiftLeft'],
	},
	{
		id: 'btn.r3',
		label: 'action_btn_r3',
		group: GROUP_TITLES.stickClicks,
		action: { t: 'b', i: BUTTON.R3 },
		icon: 'right-stick-press.svg',
		defaultInputs: ['KeyC'],
	},

	// Menu
	{
		id: 'btn.view',
		label: 'action_btn_view',
		group: GROUP_TITLES.menu,
		action: { t: 'b', i: BUTTON.View },
		icon: 'view.svg',
		defaultInputs: ['Tab'],
	},
	{
		id: 'btn.menu',
		label: 'action_btn_menu',
		group: GROUP_TITLES.menu,
		action: { t: 'b', i: BUTTON.Menu },
		icon: 'menu.svg',
		defaultInputs: ['Enter'],
	},
	{
		id: 'btn.guide',
		label: 'action_btn_guide',
		group: GROUP_TITLES.menu,
		action: { t: 'b', i: BUTTON.Guide },
		icon: 'guide.svg',
		defaultInputs: ['Backquote'],
	},

	// D-Pad
	{
		id: 'dpad.up',
		label: 'action_dpad_up',
		group: GROUP_TITLES.dpad,
		action: { t: 'b', i: BUTTON.DpadUp },
		icon: 'dpad-up.svg',
		defaultInputs: ['ArrowUp', 'Digit1'],
	},
	{
		id: 'dpad.down',
		label: 'action_dpad_down',
		group: GROUP_TITLES.dpad,
		action: { t: 'b', i: BUTTON.DpadDown },
		icon: 'dpad-down.svg',
		defaultInputs: ['ArrowDown', 'Digit2'],
	},
	{
		id: 'dpad.left',
		label: 'action_dpad_left',
		group: GROUP_TITLES.dpad,
		action: { t: 'b', i: BUTTON.DpadLeft },
		icon: 'dpad-left.svg',
		defaultInputs: ['ArrowLeft', 'Digit3'],
	},
	{
		id: 'dpad.right',
		label: 'action_dpad_right',
		group: GROUP_TITLES.dpad,
		action: { t: 'b', i: BUTTON.DpadRight },
		icon: 'dpad-right.svg',
		defaultInputs: ['ArrowRight', 'Digit4'],
	},
];

/**
 * True when every remappable controller action has at least one bound input.
 * Stick/aim info rows are mouse/keyboard-driven and not part of this check
 * (only registry actions with defaultInputs are remappable).
 */
export function allBindsConfigured(bindings: Bindings): boolean {
	const bound = new Set<string>();
	for (const id of Object.keys(bindings)) {
		const a = bindings[id];
		if (a == null) continue;
		bound.add(actionKey(a));
	}
	return CONTROLLER_ACTIONS.every((entry) => bound.has(actionKey(entry.action)));
}

/** Flatten the registry's defaultInputs -> action into a Bindings map. */
export function buildDefaultBindings(): Bindings {
	const bindings: Bindings = {};
	for (const entry of CONTROLLER_ACTIONS) {
		for (const input of entry.defaultInputs) {
			// each input id maps to exactly one action; clone to avoid shared refs
			bindings[input] = { ...entry.action } as Action;
		}
	}
	return bindings;
}

/**
 * Build the options-page groups: titled sections in render order, info groups
 * interleaved at their declared position. Titles, info text and item labels are
 * resolved to the requested locale (default = base locale). The raw message
 * keys remain the grouping identity, so resolution never affects structure.
 */
export function groupsForOptions(locale: Locale = baseLocale): ControllerGroup[] {
	const infoByTitle = new Map(INFO_GROUPS.map((g) => [g.title, g.info]));
	const order = Object.values(GROUP_TITLES);
	const groups: ControllerGroup[] = [];
	for (const key of order) {
		const items = CONTROLLER_ACTIONS.filter((a) => a.group === key).map((a) => ({
			...a,
			label: t(a.label as MessageKey, locale),
		}));
		const infoKey = infoByTitle.get(key);
		if (items.length === 0 && infoKey === undefined) continue;
		const title = t(key as MessageKey, locale);
		const fixed = FIXED_GROUP_TITLES.has(key);
		const info = infoKey === undefined ? undefined : t(infoKey as MessageKey, locale);
		groups.push(info === undefined ? { title, fixed, items } : { title, fixed, info, items });
	}
	return groups;
}
