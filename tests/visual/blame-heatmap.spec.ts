import { expect, test, type Page } from '@playwright/test';

const screenshotOptions = {
	maxDiffPixelRatio: 0.04,
};

test.describe('heatmap proof', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('heatmap paints recency bars and line tint (screenshot)', async ({ page }) => {
		await openReady(page);
		await page.getByRole('button', { name: 'View' }).click();
		await page.locator('#contentModes button', { hasText: 'Whole file' }).click();
		await page.locator('#heatmapToggle').click();
		await expect(page.locator('#pierre-diff-root')).toHaveClass(/is-heatmap-open/, { timeout: 15000 });
		await expect(page.locator('#heatmapToggle')).toHaveAttribute('aria-pressed', 'true');

		const heatCount = await waitForShadowCount(page, '.pierre-heat-bar', 1);
		expect(heatCount).toBeGreaterThan(0);
		const tintCount = await waitForShadowCount(page, '[data-jjplus-heat]', 1);
		expect(tintCount).toBeGreaterThan(0);

		await expect(page.locator('#pierre-diff-root')).toHaveScreenshot('heatmap-portal.png', screenshotOptions);
	});
});

async function openReady(page: Page) {
	await page.goto('/?fixture=jj-basic');
	await expect(page.locator('.session-loading-overlay')).toHaveCount(0, { timeout: 15000 });
	await expect(page.locator('#pierre-diff-root')).not.toHaveClass(/is-pending/, { timeout: 10000 });
	await expect(page.locator('diffs-container')).toBeVisible({ timeout: 10000 });
}

async function waitForShadowCount(page: Page, selector: string, min: number): Promise<number> {
	await expect
		.poll(
			async () =>
				page.locator('#pierre-diff-root').evaluate((root, sel) => {
					const host = root.querySelector('diffs-container');
					if (!host) {
						return 0;
					}
					const light = host.querySelectorAll(sel).length;
					const shadow = host.shadowRoot?.querySelectorAll(sel).length ?? 0;
					return light + shadow;
				}, selector),
			{ timeout: 20000 },
		)
		.toBeGreaterThanOrEqual(min);

	return page.locator('#pierre-diff-root').evaluate((root, sel) => {
		const host = root.querySelector('diffs-container');
		if (!host) {
			return 0;
		}
		const light = host.querySelectorAll(sel).length;
		const shadow = host.shadowRoot?.querySelectorAll(sel).length ?? 0;
		return light + shadow;
	}, selector);
}
