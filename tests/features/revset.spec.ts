import { expect, test } from '@playwright/test';

test.describe('revset filter', () => {
	test.use({ viewport: { width: 1400, height: 1000 } });

	test('View menu exposes revset field for jj fixtures and apply reloads timeline', async ({ page }) => {
		await page.goto('/?fixture=jj-basic');
		await expect(page.locator('.session-loading-overlay')).toHaveCount(0, { timeout: 15000 });
		await page.getByRole('button', { name: 'View options' }).click();
		await expect(page.locator('#revsetFilter')).toBeVisible();
		await page.locator('#customRevsetInput').fill('bookmarks()');
		await page.locator('#applyCustomRevsetButton').click();
		await expect(page.locator('#viewMenu')).toBeHidden({ timeout: 10000 });
		await expect(page.getByText('Revision Timeline')).toBeVisible();
	});
});
