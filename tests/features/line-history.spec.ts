import { expect, test } from '@playwright/test';

test.describe('line history filter', () => {
	test.use({ viewport: { width: 1400, height: 1000 } });

	test('shows banner for URL lineHistory and clears back to full history', async ({ page }) => {
		await page.goto('/?fixture=jj-basic&lineHistory=2-5');
		await expect(page.locator('.session-loading-overlay')).toHaveCount(0, { timeout: 15000 });
		const banner = page.locator('#lineHistoryBanner');
		await expect(banner).toBeVisible();
		await expect(banner).toContainText('Lines 2–5');
		await expect(page.locator('#clearLineHistoryButton')).toContainText('Show full file timeline');
		await page.locator('#clearLineHistoryButton').click();
		await expect(banner).toHaveCount(0);
		await expect(page.getByText('Revision Timeline')).toBeVisible();
	});
});
