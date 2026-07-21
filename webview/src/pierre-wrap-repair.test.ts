import { describe, expect, test } from 'vitest';

/** Same span math used after Pierre expands unmodified regions. */
function computeWrapRowSpan(childCounts: number[]): number {
	return Math.max(1, ...childCounts);
}

describe('pierre wrap repair', () => {
	test('row span grows with expanded unmodified line columns', () => {
		expect(computeWrapRowSpan([3, 3])).toBe(3);
		expect(computeWrapRowSpan([3, 12])).toBe(12);
		expect(computeWrapRowSpan([])).toBe(1);
	});
});
