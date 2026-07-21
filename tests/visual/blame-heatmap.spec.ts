import { expect, test, type Page } from '@playwright/test';

const screenshotOptions = {
	maxDiffPixelRatio: 0.04,
};

test.describe('blame and heatmap proof', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('blame overlay annotates after-side gutter (screenshot)', async ({ page }) => {
		await openReady(page);
		await page.getByRole('button', { name: 'View' }).click();
		await page.locator('#contentModes button', { hasText: 'Whole file' }).click();
		await page.keyboard.press('Escape');
		await expect(page.locator('#toggleBlameOverlayButton')).toBeVisible();
		await page.locator('#toggleBlameOverlayButton').click();
		await expect(page.locator('#pierre-diff-root')).toHaveClass(/is-blame-open/, { timeout: 15000 });
		await expect(page.locator('#toggleBlameOverlayButton')).toHaveAttribute('aria-pressed', 'true');

		const annotationCount = await waitForShadowCount(page, '.pierre-blame-annotation', 1);
		expect(annotationCount).toBeGreaterThan(0);

		await expect(page.locator('#pierre-diff-root')).toHaveScreenshot('blame-overlay-portal.png', screenshotOptions);
	});

	test('heatmap paints recency bars (screenshot)', async ({ page }) => {
		await openReady(page);
		await page.getByRole('button', { name: 'View' }).click();
		await page.locator('#contentModes button', { hasText: 'Whole file' }).click();
		await page.locator('#heatmapToggle').click();
		await expect(page.locator('#pierre-diff-root')).toHaveClass(/is-heatmap-open/, { timeout: 15000 });
		await expect(page.locator('#heatmapToggle')).toHaveAttribute('aria-pressed', 'true');

		const heatCount = await waitForShadowCount(page, '.pierre-heat-bar', 1);
		expect(heatCount).toBeGreaterThan(0);

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
