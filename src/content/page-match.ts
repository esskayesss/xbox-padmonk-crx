// URL/path helpers for Xbox Cloud Gaming surfaces.

/**
 * True on an active game stream route. Used only to fade the HUD during play,
 * not on dashboards or tester pages.
 */
export function isActiveGamePath(pathname: string): boolean {
	return /\/play\/launch\//.test(pathname) || /^\/stream\//.test(pathname);
}
