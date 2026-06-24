// Keyboard combo helpers, ported from the legacy options.js / inject.js.

import { baseLocale, m, type Locale } from './i18n';
import { prettyInput } from './labels';
import type { Combo } from './types';

/**
 * Build a combo from a keydown event. A modifier flag is set only when that
 * modifier is held *and* the pressed key is not the modifier itself — so
 * pressing Shift alone yields a plain `ShiftLeft` combo, not shift+ShiftLeft.
 */
export function comboFromEvent(e: KeyboardEvent): Combo {
	return {
		code: e.code,
		ctrl: e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight',
		alt: e.altKey && e.code !== 'AltLeft' && e.code !== 'AltRight',
		shift: e.shiftKey && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight',
		meta: e.metaKey && e.code !== 'MetaLeft' && e.code !== 'MetaRight',
	};
}

/** Render a combo as "Ctrl+Alt+Shift+Meta+Key" in that fixed order. */
export function comboLabel(combo: Combo, locale: Locale = baseLocale): string {
	const parts: string[] = [];
	if (combo.ctrl) parts.push(m.combo_ctrl({}, { locale }));
	if (combo.alt) parts.push(m.combo_alt({}, { locale }));
	if (combo.shift) parts.push(m.combo_shift({}, { locale }));
	if (combo.meta) parts.push(m.combo_meta({}, { locale }));
	parts.push(prettyInput(combo.code, locale));
	return parts.join('+');
}

/** True when a keyboard event exactly matches a combo (code + all modifiers). */
export function comboMatches(combo: Combo, e: KeyboardEvent): boolean {
	return (
		e.code === combo.code &&
		Boolean(e.ctrlKey) === Boolean(combo.ctrl) &&
		Boolean(e.altKey) === Boolean(combo.alt) &&
		Boolean(e.shiftKey) === Boolean(combo.shift) &&
		Boolean(e.metaKey) === Boolean(combo.meta)
	);
}
