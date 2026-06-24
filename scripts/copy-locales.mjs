// Postbuild: ensure the generated _locales/ tree lands in dist/.
//
// @crxjs/vite-plugin copies the manifest and its referenced assets, but the
// Chrome-native _locales/ directory is NOT a manifest-referenced asset (it is
// resolved by Chrome at runtime via __MSG_*__ + default_locale), so the bundler
// leaves it behind. This copies the regenerated tree into the build output so
// the packaged extension can localize its name/description/toolbar tooltip.
//
// Runs after `vite build`. Idempotent — safe to re-run.

import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, '_locales');
const dest = resolve(root, 'dist', '_locales');

if (!existsSync(src)) {
	throw new Error('copy-locales: _locales/ not found — run `npm run gen:locales` first');
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log('copy-locales: copied _locales/ -> dist/_locales/');
