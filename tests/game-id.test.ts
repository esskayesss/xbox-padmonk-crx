import { describe, expect, it } from 'vitest';
import { PRODUCT_ID_RE, gameRefFromPath } from '../src/content/page-match';

describe('gameRefFromPath', () => {
	it('legacy detail picks slug BEFORE the id (id is last)', () => {
		const ref = gameRefFromPath('/en-US/play/games/forza-horizon-5/9NKX70BBCDRN');
		expect(ref).toEqual({ productId: '9NKX70BBCDRN', slug: 'forza-horizon-5' });
	});

	it('legacy launch picks slug AFTER the id (id is first)', () => {
		const ref = gameRefFromPath('/en-US/play/launch/9N872NBW5XG5/call-of-duty');
		expect(ref).toEqual({ productId: '9N872NBW5XG5', slug: 'call-of-duty' });
	});

	it('new stream route picks slug AFTER the id', () => {
		const ref = gameRefFromPath('/stream/C17GQF31D617/halo-infinite');
		expect(ref).toEqual({ productId: 'C17GQF31D617', slug: 'halo-infinite' });
	});

	it('returns null when no segment matches the Big-ID shape', () => {
		expect(gameRefFromPath('/')).toBeNull();
		expect(gameRefFromPath('/en-US/play')).toBeNull();
		expect(gameRefFromPath('/gallery/all-games')).toBeNull();
	});

	it('returns a GameRef with empty slug when the id has no adjacent human segment', () => {
		expect(gameRefFromPath('/9NKX70BBCDRN')).toEqual({ productId: '9NKX70BBCDRN', slug: '' });
	});
});

describe('PRODUCT_ID_RE', () => {
	it('accepts valid Big IDs (12 uppercase alnum, >=1 digit)', () => {
		for (const id of ['9NKX70BBCDRN', 'C17GQF31D617', '9N872NBW5XG5', '9NCJSXWZTP88']) {
			expect(PRODUCT_ID_RE.test(id)).toBe(true);
		}
	});

	it('rejects all-letters (no digit)', () => {
		expect(PRODUCT_ID_RE.test('ABCDEFGHIJKL')).toBe(false);
	});

	it('rejects lowercase', () => {
		expect(PRODUCT_ID_RE.test('9nkx70bbcdrn')).toBe(false);
	});

	it('rejects wrong length (11 / 13)', () => {
		expect(PRODUCT_ID_RE.test('9NKX70BBCDR')).toBe(false);
		expect(PRODUCT_ID_RE.test('9NKX70BBCDRNX')).toBe(false);
	});

	it('rejects hyphenated slugs', () => {
		expect(PRODUCT_ID_RE.test('forza-horizon-5')).toBe(false);
	});
});
