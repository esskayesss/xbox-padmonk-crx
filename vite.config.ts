import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crx } from '@crxjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import manifest from './manifest.config';
import { BUILD_STAMP } from './build-stamp';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	define: {
		// compile-time constant injected into the runtime (see src/content/inject.ts)
		__BUILD_STAMP__: JSON.stringify(BUILD_STAMP),
	},
	plugins: [
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/paraglide',
			// Locale is always passed explicitly (config.locale) at every call site,
			// so Paraglide's own detection never runs — baseLocale is a safe stub.
			strategy: ['baseLocale'],
		}),
		crx({ manifest }),
		svelte(),
		tailwindcss(),
	],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			// The what's-new page is NOT manifest-referenced (the SW opens it via
			// chrome.tabs.create), so crxjs won't discover it. Register it as an
			// explicit input; crxjs merges its own manifest-derived inputs with this.
			input: {
				whatsnew: resolve(rootDir, 'src/whatsnew/index.html'),
			},
		},
	},
});
