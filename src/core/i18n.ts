// padmonk i18n seam — the single import surface for translated strings.
//
// Strings are authored in messages/{locale}.json and compiled by Paraglide JS
// (`npm run i18n`) into src/paraglide/ (gitignored). We deliberately bypass
// Paraglide's locale *detection* entirely: the active locale lives in
// Config.locale and is threaded to every call site as an explicit option.
// That is what makes the SAME message functions work in three very different
// runtimes — the popup/options pages, the vitest suite, and the MAIN-world
// content-script overlay (which has no `chrome.*` and no browser-locale source).
//
// Usage:
//   - static strings:  m.opt_title({}, { locale })
//   - dynamic keys (registry-driven labels): t(key, locale, params?)

import { m } from '../paraglide/messages.js';
import { baseLocale, locales, isLocale } from '../paraglide/runtime.js';
import type { Locale } from '../paraglide/runtime.js';

export { m, baseLocale, locales, isLocale };
export type { Locale };

/** Every compiled message key (e.g. "action_btn_a", "opt_title"). */
export type MessageKey = keyof typeof m;

type MessageFn = (inputs?: Record<string, unknown>, options?: { locale?: Locale }) => string;

/**
 * Resolve a message by *dynamic* key in an explicit locale. Use this only when
 * the key is data-driven (controller-actions / aim-settings registries). For
 * literal keys prefer `m.someKey({}, { locale })` so the bundler can tree-shake.
 * The param accepts any string (registry labels are typed `string`) while still
 * offering autocomplete for known keys.
 */
export function t(
	key: MessageKey | (string & {}),
	locale: Locale,
	params?: Record<string, unknown>,
): string {
	return (m[key as MessageKey] as MessageFn)(params ?? {}, { locale });
}

/** Coerce an arbitrary stored value to a supported locale, else the base locale. */
export function coerceLocale(value: unknown): Locale {
	return typeof value === 'string' && isLocale(value) ? value : baseLocale;
}

/**
 * Resolve a browser UI-language tag (e.g. from chrome.i18n.getUILanguage())
 * to a supported locale. Unlike coerceLocale (a strict storage coercer), this
 * does BCP-47 primary-subtag fallback so region tags map sensibly:
 *   - exact match first ("pt-BR" -> "pt-BR")
 *   - else primary subtag ("en-US" -> "en")
 *   - else the single shipped regional variant of that language
 *     ("zh-TW"/"zh" -> "zh-CN", "pt-PT"/"pt" -> "pt-BR") when exactly one exists
 *   - else baseLocale
 * Case-insensitive on the region ("PT-br" still resolves). The regional-variant
 * fallback is derived from the shipped `locales` set, not hardcoded, so it stays
 * correct as locales are added/removed. Used only for first-run locale seeding;
 * coerceLocale stays the storage path and is unchanged.
 */
export function resolveUiLocale(raw: string): Locale {
	if (typeof raw !== 'string' || raw.length === 0) return baseLocale;
	if (isLocale(raw)) return raw;
	// Try a canonical-cased exact match (e.g. "pt-br" -> "pt-BR").
	const lower = raw.toLowerCase();
	for (const loc of locales) {
		if (loc.toLowerCase() === lower) return loc;
	}
	// Primary subtag fallback ("en-US" -> "en").
	const primary = lower.split('-')[0];
	if (isLocale(primary)) return primary;
	// Region-family fallback: if the language ships exactly one regional variant
	// (e.g. only "zh-CN" for "zh", only "pt-BR" for "pt"), prefer it over English
	// for any region tag of that language ("zh-TW" -> "zh-CN", "pt-PT" -> "pt-BR").
	const family = locales.filter((loc) => loc.toLowerCase().split('-')[0] === primary);
	if (family.length === 1) return family[0];
	return baseLocale;
}

/** The language's own display name, e.g. "English" for `en`. */
export function localeName(locale: Locale): string {
	return t(`lang_name_${locale}` as MessageKey, locale);
}
