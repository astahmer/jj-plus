import { expect, test, type Page } from '@playwright/test';

test.describe('file switcher modes', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('exposes Changed files and All files in revision modes', async ({ page }) => {
		await openFixture(page);
		await expect(page.getByRole('tablist', { name: 'File switcher mode' })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'Changed files' })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'All files in revision' })).toBeVisible();
		await page.getByRole('tab', { name: 'All files in revision' }).click();
		await expect(page.getByRole('tab', { name: 'All files in revision' })).toHaveAttribute('aria-selected', 'true');
		await page.getByRole('tab', { name: 'Changed files' }).click();
		await expect(page.getByRole('tab', { name: 'Changed files' })).toHaveAttribute('aria-selected', 'true');
	});
});

async function openFixture(page: Page) {
	await page.goto('/?fixture=jj-basic');
	await expect(page.locator('.session-loading-overlay')).toHaveCount(0, { timeout: 15000 });
	await expect(page.getByText('Revision Timeline')).toBeVisible();
}
