import { expect, test, type Page } from '@playwright/test';

const screenshotOptions = {
	maxDiffPixelRatio: 0.02,
};

test.describe('timeline visuals', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('jj snapshot layout matches the restored baseline', async ({ page }) => {
		await openFixture(page, 'jj-basic');
		await expect(page.locator('.workspace')).toHaveScreenshot('jj-basic-workspace.png', screenshotOptions);
	});

	test('git range layout matches the restored baseline', async ({ page }) => {
		await openFixture(page, 'git-basic');
		await expect(page.locator('.workspace')).toHaveScreenshot('git-basic-workspace.png', screenshotOptions);
	});

	test('blame overlay paints gutter annotations', async ({ page }) => {
		await openFixture(page, 'jj-basic');
		await page.locator('#toggleBlameOverlayButton').click();
		await expect(page.locator('#pierre-diff-root')).toHaveClass(/is-blame-open/, { timeout: 15000 });
		await expect
			.poll(
				async () =>
					page.locator('#pierre-diff-root').evaluate((root) => {
						const host = root.querySelector('diffs-container');
						if (!host) {
							return 0;
						}
						const light = host.querySelectorAll('.pierre-blame-annotation, .pierre-gutter-extras').length;
						const shadow = host.shadowRoot?.querySelectorAll('.pierre-blame-annotation, .pierre-gutter-extras').length;
						return light + (shadow ?? 0);
					}),
				{ timeout: 15000 },
			)
			.toBeGreaterThan(0);
		await expect(page.locator('#diffHead')).toHaveScreenshot('jj-blame-overlay-head.png', screenshotOptions);
	});

	test('heatmap paints recency bars in the after gutter', async ({ page }) => {
		await openFixture(page, 'jj-basic');
		await page.getByRole('button', { name: 'View' }).click();
		await page.locator('#heatmapToggle').click();
		await expect(page.locator('#pierre-diff-root')).toHaveClass(/is-heatmap-open/, { timeout: 15000 });
		await expect
			.poll(
				async () =>
					page.locator('#pierre-diff-root').evaluate((root) => {
						const host = root.querySelector('diffs-container');
						if (!host) {
							return 0;
						}
						const light = host.querySelectorAll('.pierre-heat-bar, .pierre-heat-wrap').length;
						const shadow = host.shadowRoot?.querySelectorAll('.pierre-heat-bar, .pierre-heat-wrap').length;
						return light + (shadow ?? 0);
					}),
				{ timeout: 15000 },
			)
			.toBeGreaterThan(0);
	});
});

async function openFixture(page: Page, fixture: string) {
	await page.goto(`/?fixture=${fixture}`);
	await expect(page.locator('.session-loading-overlay')).toHaveCount(0, { timeout: 15000 });
	await expect(page.getByText('Revision Timeline')).toBeVisible();
	await expect(page.locator('#diffTitle')).not.toHaveText('No diff available');
	await expect(page.locator('#pierre-diff-root')).not.toHaveClass(/is-pending/, { timeout: 10000 });
	await expect(page.locator('diffs-container')).toBeVisible({ timeout: 10000 });
	await expect
		.poll(async () =>
			page.locator('diffs-container').evaluate((el) => {
				const root = el.shadowRoot;
				if (!root) {
					return 0;
				}
				return root.querySelectorAll('[data-line], .line, pre code span, pre span').length;
			}),
		)
		.toBeGreaterThan(5);

	const layout = await page.evaluate(() => {
		const portal = document.getElementById('pierre-diff-root');
		const rows = document.getElementById('diffRows');
		const container = portal?.querySelector('diffs-container');
		const lines = [...(container?.shadowRoot?.querySelectorAll('[data-line]') ?? [])] as HTMLElement[];
		const viewportH = Math.round(window.visualViewport?.height ?? window.innerHeight);
		return {
			viewportH,
			portalH: portal ? Math.round(portal.getBoundingClientRect().height) : 0,
			rowsH: rows ? Math.round(rows.getBoundingClientRect().height) : 0,
			maxLineH: Math.max(0, ...lines.map((line) => Math.round(line.getBoundingClientRect().height))),
		};
	});
	expect(layout.portalH).toBeGreaterThan(layout.viewportH * 0.4);
	expect(layout.rowsH).toBeGreaterThan(layout.viewportH * 0.4);
	expect(layout.maxLineH).toBeLessThan(40);

	if (fixture === 'jj-basic') {
		await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeVisible();
	}
}
