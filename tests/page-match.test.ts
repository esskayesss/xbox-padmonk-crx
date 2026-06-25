import { describe, expect, it } from 'vitest';
import { isActiveGamePath } from '../src/content/page-match';

describe('Xbox game-route detection', () => {
	it('recognizes legacy xbox.com launch routes', () => {
		expect(isActiveGamePath('/en-US/play/launch/9N872NBW5XG5/call-of-duty')).toBe(true);
	});

	it('recognizes the new play.xbox.com stream routes', () => {
		expect(isActiveGamePath('/stream/9N872NBW5XG5/call-of-duty-modern-warfare-ii')).toBe(true);
	});

	it('does not treat dashboard routes as active gameplay', () => {
		expect(isActiveGamePath('/')).toBe(false);
		expect(isActiveGamePath('/en-US/play')).toBe(false);
		expect(isActiveGamePath('/gallery/all-games')).toBe(false);
	});
});
