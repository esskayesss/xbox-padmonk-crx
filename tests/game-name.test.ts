import { describe, expect, it } from 'vitest';
import { gameNameFromTitle } from '../src/content/page-match';

describe('gameNameFromTitle', () => {
	it('parses "Play ⟨Game⟩ | Xbox Cloud Gaming (Beta)" titles', () => {
		expect(
			gameNameFromTitle('Play Forza Horizon 5 | Xbox Cloud Gaming (Beta)', 'forza-horizon-5'),
		).toBe('Forza Horizon 5');
	});

	it('parses "⟨Game⟩ | Xbox" titles', () => {
		expect(gameNameFromTitle('Halo Infinite | Xbox', 'halo-infinite')).toBe('Halo Infinite');
	});

	it('falls back to the prettified slug for an empty title', () => {
		expect(gameNameFromTitle('', 'forza-horizon-5')).toBe('Forza Horizon 5');
	});

	it('falls back to the prettified slug for boilerplate-only titles', () => {
		expect(gameNameFromTitle('Xbox Cloud Gaming (Beta)', 'forza-horizon-5')).toBe(
			'Forza Horizon 5',
		);
		expect(gameNameFromTitle('Xbox', 'halo-infinite')).toBe('Halo Infinite');
	});

	it('strips a bare leading "Play " even without a separator', () => {
		expect(gameNameFromTitle('Play Starfield', 'starfield')).toBe('Starfield');
	});

	it('returns "" when both title and slug are empty', () => {
		expect(gameNameFromTitle('', '')).toBe('');
	});

	it('is defensive against non-string inputs', () => {
		// @ts-expect-error exercising runtime guards
		expect(gameNameFromTitle(undefined, 'halo-infinite')).toBe('Halo Infinite');
		// @ts-expect-error exercising runtime guards
		expect(gameNameFromTitle('Halo Infinite | Xbox', undefined)).toBe('Halo Infinite');
	});
});
