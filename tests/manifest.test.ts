import { describe, expect, it } from 'vitest';
import manifest from '../manifest.config';

type ManifestLike = {
	content_scripts?: Array<{ matches?: string[] }>;
	web_accessible_resources?: Array<{ matches?: string[] }>;
};

async function resolvedManifest(): Promise<ManifestLike> {
	return (await manifest) as unknown as ManifestLike;
}

describe('extension manifest URL coverage', () => {
	it('injects content scripts on the new play.xbox.com experience before SPA routing', async () => {
		const resolved = await resolvedManifest();
		const scripts = resolved.content_scripts ?? [];
		expect(scripts.length).toBeGreaterThan(0);
		for (const script of scripts) {
			expect(script.matches).toContain('https://play.xbox.com/*');
		}
	});

	it('allows web-accessible UI assets on play.xbox.com', async () => {
		const resolved = await resolvedManifest();
		const resources = resolved.web_accessible_resources ?? [];
		expect(resources).toHaveLength(1);
		expect(resources[0].matches).toContain('https://play.xbox.com/*');
	});
});
