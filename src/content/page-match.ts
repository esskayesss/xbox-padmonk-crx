// URL/path helpers for Xbox Cloud Gaming surfaces.

/**
 * True on an active game stream route. Used only to fade the HUD during play,
 * not on dashboards or tester pages.
 */
export function isActiveGamePath(pathname: string): boolean {
	return /\/play\/launch\//.test(pathname) || /^\/stream\//.test(pathname);
}

/**
 * Microsoft Store "Big ID" (product id) shape: exactly 12 uppercase
 * alphanumerics with at least one digit, no hyphen (e.g. "9NCJSXWZTP88",
 * "C17GQF31D617"). Localized slugs are lowercase-hyphen and can't match, so this
 * is a safe discriminator across all Xbox surfaces (plan §2).
 */
export const PRODUCT_ID_RE = /^(?=[0-9A-Z]{12}$)(?=.*[0-9])[0-9A-Z]{12}$/;

/** A game's permanent product id plus its (localized, label-only) slug. */
export interface GameRef {
	productId: string;
	slug: string;
}

/**
 * Extract the product id + slug from a pathname, position-agnostically (plan §2).
 * The id position differs per surface:
 *   - legacy detail `/<loc>/play/games/<slug>/<id>` (slug BEFORE id)
 *   - legacy launch `/<loc>/play/launch/<id>/<slug>` (slug AFTER id)
 *   - new          `/stream/<id>/<slug>`             (slug AFTER id)
 *
 * Strategy: split on '/', find the first segment matching PRODUCT_ID_RE. The
 * slug is the segment immediately AFTER the id when it's a non-empty,
 * non-product-id segment; otherwise the segment immediately BEFORE. Returns null
 * when no segment matches the Big-ID shape.
 */
export function gameRefFromPath(pathname: string): GameRef | null {
	const segments = pathname.split('/').filter((s) => s.length > 0);
	const idx = segments.findIndex((s) => PRODUCT_ID_RE.test(s));
	if (idx === -1) return null;
	const productId = segments[idx];

	const after = segments[idx + 1];
	const before = segments[idx - 1];
	const pickable = (s: string | undefined): s is string =>
		typeof s === 'string' && s.length > 0 && !PRODUCT_ID_RE.test(s);

	const slug = pickable(after) ? after : pickable(before) ? before : '';
	return { productId, slug };
}
