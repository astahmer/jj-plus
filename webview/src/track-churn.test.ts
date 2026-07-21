import { expect, test } from 'vitest';
import { churnFromDiffCount, normalizeTrackChurnBars } from './domain/track-churn.ts';

test('normalizeTrackChurnBars scales relative to peak', () => {
	const bars = normalizeTrackChurnBars(
		[
			{ entryIndex: 0, churn: 0 },
			{ entryIndex: 1, churn: 5 },
			{ entryIndex: 2, churn: 10 },
		],
		{ minFactor: 0.2, maxFactor: 1 },
	);
	expect(bars[0].heightFactor).toBeCloseTo(0.2);
	expect(bars[1].heightFactor).toBeCloseTo(0.6);
	expect(bars[2].heightFactor).toBeCloseTo(1);
});

test('normalizeTrackChurnBars uses min when all zero', () => {
	const bars = normalizeTrackChurnBars([
		{ entryIndex: 0, churn: 0 },
		{ entryIndex: 1, churn: 0 },
	]);
	expect(bars.every((bar) => bar.heightFactor === 0.2)).toBe(true);
});

test('churnFromDiffCount treats missing as zero', () => {
	expect(churnFromDiffCount(undefined)).toBe(0);
	expect(churnFromDiffCount(3)).toBe(3);
});
