import { describe, expect, test } from 'vitest';
import { computeOverlayGeometry } from './view/overlay-portal.ts';

describe('overlay portal placement', () => {
	test('clamps end-aligned panels inside the viewport', () => {
		const geometry = computeOverlayGeometry(
			{ top: 250, bottom: 274, left: 300, right: 380, width: 80, height: 24 },
			{ width: 220, height: 180 },
			{ width: 400, height: 300 },
			{ maxWidth: 240, maxHeight: 160, align: 'end' },
		);

		expect(geometry.top).toBeLessThanOrEqual(300 - 12);
		expect(geometry.left).toBeGreaterThanOrEqual(12);
		expect(geometry.left + geometry.width).toBeLessThanOrEqual(400);
		expect(geometry.width).toBeLessThanOrEqual(240);
	});

	test('flips above when there is no room below', () => {
		const geometry = computeOverlayGeometry(
			{ top: 250, bottom: 274, left: 40, right: 200, width: 160, height: 24 },
			{ width: 280, height: 200 },
			{ width: 800, height: 300 },
			{ maxHeight: 200, prefer: 'auto' },
		);

		expect(geometry.top).toBeLessThan(250);
		expect(geometry.top).toBeGreaterThanOrEqual(12);
	});

	test('keeps to-combobox end alignment on screen', () => {
		const geometry = computeOverlayGeometry(
			{ top: 40, bottom: 64, left: 500, right: 700, width: 200, height: 24 },
			{ width: 280, height: 120 },
			{ width: 800, height: 600 },
			{ align: 'end', maxWidth: 720, minWidth: 280 },
		);

		expect(geometry.left).toBe(420);
		expect(geometry.left + geometry.width).toBeLessThanOrEqual(800);
	});
});
