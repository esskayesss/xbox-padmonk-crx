// Labels for input ids. Single source of truth — fixes the legacy drift where
// inject.js lacked Mouse3/Mouse4 that options.js had (REBUILD.md bug item 2).
//
// Named inputs resolve through i18n; dynamic identities (KeyW -> "W",
// Digit1 -> "1") and pass-through codes (Space, F8, Enter) stay verbatim since
// they carry no translatable words.

import { baseLocale, t, type Locale, type MessageKey } from './i18n';

/** Message key for each named input id; absent ids fall back to derivation. */
const NAMED: Record<string, MessageKey> = {
	Mouse0: 'input_mouse_left',
	Mouse1: 'input_mouse_middle',
	Mouse2: 'input_mouse_right',
	Mouse3: 'input_mouse4',
	Mouse4: 'input_mouse5',
	WheelUp: 'input_wheel_up',
	WheelDown: 'input_wheel_down',
	ArrowUp: 'input_arrow_up',
	ArrowDown: 'input_arrow_down',
	ArrowLeft: 'input_arrow_left',
	ArrowRight: 'input_arrow_right',
	ControlLeft: 'input_ctrl_left',
	ControlRight: 'input_ctrl_right',
	ShiftLeft: 'input_shift_left',
	ShiftRight: 'input_shift_right',
	AltLeft: 'input_alt_left',
	AltRight: 'input_alt_right',
	Backquote: 'input_backquote',
};

/** Human-readable label for an input id, in the given locale (default base). */
export function prettyInput(id: string, locale: Locale = baseLocale): string {
	const key = NAMED[id];
	if (key) return t(key, locale);
	if (id.startsWith('Key')) return id.slice(3);
	if (id.startsWith('Digit')) return id.slice(5);
	return id;
}

/** Prettify a hyphen-slug into a Title-Case label ("forza-horizon-5" -> "Forza Horizon 5"). */
export function prettifySlug(slug: string): string {
	return slug
		.split('-')
		.filter((w) => w.length > 0)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}
