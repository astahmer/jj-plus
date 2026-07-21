import { expect, test } from '@playwright/test';

test.describe('track churn bars', () => {
	test.use({ viewport: { width: 1400, height: 1000 } });

	test('anchors expose churn data attributes after entry counts load', async ({ page }) => {
		await page.goto('/?fixture=jj-basic');
		await expect(page.locator('.session-loading-overlay')).toHaveCount(0, { timeout: 15000 });
		await expect(page.locator('#track .track-anchor').first()).toBeVisible();
		await expect
			.poll(async () => page.locator('#track .track-anchor[data-churn-factor]').count(), { timeout: 10000 })
			.toBeGreaterThan(0);
		const factors = await page
			.locator('#track .track-anchor')
			.evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.churnFactor || '0')));
		expect(factors.every((value) => value >= 0.2 && value <= 1)).toBe(true);
	});
});
