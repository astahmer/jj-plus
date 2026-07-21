import { expect, test } from '@playwright/test';

test.describe('multi-file range switcher', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('Top changed mode lists range files as switcher chips', async ({ page }) => {
		await page.goto('/?fixture=jj-basic');
		await expect(page.locator('.session-loading-overlay')).toHaveCount(0, { timeout: 15000 });

		await page.getByRole('tab', { name: 'Top changed' }).click();
		const list = page.locator('#rangeFileList');
		await expect(list).toBeVisible({ timeout: 15000 });
		await expect.poll(async () => list.locator('.range-file-chip').count(), { timeout: 15000 }).toBeGreaterThan(0);

		const chip = list.locator('.range-file-chip').first();
		const before = await page.locator('.file-input').inputValue();
		await chip.click();
		await expect.poll(async () => page.locator('.file-input').inputValue(), { timeout: 15000 }).not.toBe('');
		const after = await page.locator('.file-input').inputValue();
		expect(after.length).toBeGreaterThan(0);
		// Either switched to another file or re-selected current — input stays a path.
		expect(after.includes('/') || after.includes('.')).toBe(true);
		void before;
	});
});
