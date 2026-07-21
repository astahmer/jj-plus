import { expect, test, type Page } from '@playwright/test';

test.describe('overlay popovers', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('view menu shows Layout, Content, and History without clipping', async ({ page }) => {
		await openFixture(page);
		const viewYBefore = await page.locator('#viewMenuButton').evaluate((el) => el.getBoundingClientRect().y);

		await page.getByRole('button', { name: 'View options' }).click();
		const menu = page.locator('#viewMenu');
		await expect(menu).toBeVisible();
		await expect(menu.getByText('Layout', { exact: true })).toBeVisible();
		await expect(menu.getByText('Content', { exact: true })).toBeVisible();
		await expect(menu.getByText('History', { exact: true })).toBeVisible();
		await expect(menu.locator('#layoutModes')).toBeVisible();
		await expect(menu.locator('#contentModes')).toBeVisible();
		await expect(menu.locator('#intermediateToggle')).toBeVisible();

		const box = await menu.boundingBox();
		expect(box).toBeTruthy();
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.y + box!.height).toBeLessThanOrEqual(1100 + 1);
		expect(await menu.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
		expect(await menu.evaluate((el) => getComputedStyle(el).overflowY)).toMatch(/auto|scroll/);

		const viewYAfter = await page.locator('#viewMenuButton').evaluate((el) => el.getBoundingClientRect().y);
		expect(Math.abs(viewYAfter - viewYBefore)).toBeLessThan(2);
	});

	test('shortcuts popover is fully in viewport above View menu and does not shift toolbar', async ({ page }) => {
		await openFixture(page);
		const viewButton = page.locator('#viewMenuButton');
		const viewYBefore = await viewButton.evaluate((el) => el.getBoundingClientRect().y);

		await page.getByRole('button', { name: 'Show hotkeys' }).click();
		const popover = page.locator('#hotkeysPopover');
		const card = page.locator('.hotkeys-card');
		await expect(popover).toBeVisible();
		await expect(card.getByText('Selection', { exact: true })).toBeVisible();
		await expect(card.getByText('Actions', { exact: true })).toBeVisible();
		await expect(card.getByText('Toggle help')).toBeVisible();
		await expect(card.getByText('Exit focus / overlays')).toBeVisible();

		const popBox = await popover.boundingBox();
		const viewBox = await viewButton.boundingBox();
		expect(popBox).toBeTruthy();
		expect(viewBox).toBeTruthy();
		expect(popBox!.y).toBeGreaterThanOrEqual(0);
		expect(popBox!.y + popBox!.height).toBeLessThanOrEqual(1100 + 1);
		expect(Number(await popover.evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThanOrEqual(60);

		const viewYAfter = await viewButton.evaluate((el) => el.getBoundingClientRect().y);
		expect(Math.abs(viewYAfter - viewYBefore)).toBeLessThan(2);

		const scrollHeight = await card.evaluate((el) => el.scrollHeight);
		const clientHeight = await card.evaluate((el) => el.clientHeight);
		expect(clientHeight).toBeGreaterThan(0);
		expect(scrollHeight).toBeGreaterThanOrEqual(clientHeight);
	});
});

async function openFixture(page: Page) {
	await page.goto('/?fixture=jj-basic');
	await expect(page.locator('.session-loading-overlay')).toHaveCount(0, { timeout: 15000 });
	await expect(page.getByText('Revision Timeline')).toBeVisible();
}
