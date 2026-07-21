import { expect, test, type Page } from '@playwright/test';

type DiffLayoutMetrics = {
	viewportH: number;
	portalH: number;
	hostH: number;
	hostScrollH: number;
	rowsH: number;
	contentH: number;
	timelineH: number;
	maxLineH: number;
	minLineH: number;
	lineCount: number;
	maxCodeScrollH: number;
	minCodeClientH: number;
	portalFillRatio: number;
	lineTopSpan: number;
	uniqueLineTops: number;
	isCrushed: boolean;
};

test.describe('diff vertical layout', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('normal layout gives the diff the majority of vertical space', async ({ page }) => {
		await openFixture(page, 'jj-basic');

		const layout = await measureDiffLayout(page);
		expect(layout.timelineH).toBeLessThan(layout.viewportH * 0.45);
		expect(layout.portalH).toBeGreaterThan(layout.viewportH * 0.4);
		expect(layout.rowsH).toBeGreaterThan(layout.viewportH * 0.4);
		expect(layout.portalFillRatio).toBeGreaterThan(0.4);
		expect(layout.hostH).toBeGreaterThanOrEqual(layout.portalH - 8);
		expect(layout.maxLineH).toBeLessThan(40);
		expect(layout.minLineH).toBeGreaterThan(8);
		expect(layout.lineCount).toBeGreaterThan(5);
		expect(Math.max(layout.maxCodeScrollH, layout.hostScrollH, layout.minCodeClientH)).toBeGreaterThan(40);
		expect(layout.isCrushed).toBe(false);
	});

	test('focus diff expands the portal to nearly the full viewport height', async ({ page }) => {
		await openFixture(page, 'jj-basic');

		const before = await measureDiffLayout(page);
		await page.getByRole('button', { name: 'Focus diff' }).click();
		await expect(page.locator('.workspace')).toHaveClass(/is-diff-focus/);
		await expect(page.getByRole('button', { name: 'Exit focus' })).toBeVisible();

		await expect.poll(async () => (await measureDiffLayout(page)).portalFillRatio).toBeGreaterThan(0.7);

		const focused = await measureDiffLayout(page);
		expect(focused.portalH).toBeGreaterThan(before.portalH);
		expect(focused.portalH).toBeGreaterThan(focused.viewportH * 0.7);
		expect(focused.rowsH).toBeGreaterThan(focused.viewportH * 0.65);
		expect(focused.hostH).toBeGreaterThanOrEqual(focused.portalH - 8);
		expect(focused.maxLineH).toBeLessThan(40);
		expect(focused.minLineH).toBeGreaterThan(8);
		expect(focused.isCrushed).toBe(false);
	});

	test('git fixture also keeps a tall scrollable diff surface', async ({ page }) => {
		await openFixture(page, 'git-basic');

		const layout = await measureDiffLayout(page);
		expect(layout.portalH).toBeGreaterThan(layout.viewportH * 0.4);
		expect(layout.rowsH).toBeGreaterThan(layout.viewportH * 0.4);
		expect(layout.hostH).toBeGreaterThanOrEqual(layout.portalH - 8);
		expect(layout.maxLineH).toBeLessThan(40);
		expect(layout.minLineH).toBeGreaterThan(8);
		expect(layout.isCrushed).toBe(false);

		await page.getByRole('button', { name: 'Focus diff' }).click();
		await expect
			.poll(async () => {
				const next = await measureDiffLayout(page);
				return next.portalFillRatio > 0.7 && !next.isCrushed && next.hostH >= next.portalH - 8;
			})
			.toBe(true);
	});

	test('large main.ts rewrite stays scrollable in unified layout', async ({ page }) => {
		await openFixture(page, 'jj-basic');
		await switchToFile(page, 'apps/web/src/main.ts');
		await page.locator('.history-list .history-item').filter({ hasText: 'componentize stuff' }).first().click();
		await page.locator('.history-list .history-item').filter({ hasText: 'implement vector search' }).first().click();
		await page.getByRole('button', { name: 'View options' }).click();
		await page.locator('#layoutModes .segment', { hasText: 'Unified' }).click();
		await expect(page.locator('#layoutModes .segment.active')).toHaveText('Unified');

		await expect
			.poll(
				async () => {
					const layout = await measureDiffLayout(page);
					return (
						layout.lineCount > 40 &&
						!layout.isCrushed &&
						layout.hostScrollH > layout.portalH + 40 &&
						layout.uniqueLineTops > 10
					);
				},
				{ timeout: 30000 },
			)
			.toBe(true);
	});
});

async function switchToFile(page: Page, relativePath: string) {
	const switcher = page.locator('#fileSwitcher');
	await switcher.click();
	await switcher.fill('');
	await switcher.type(relativePath);
	await switcher.press('Enter');
	await page.waitForFunction((path) => window.__TIMELINE_TEST_STATE__?.activeRelativePath === path, relativePath, {
		timeout: 15000,
	});
	await expect(page.locator('.history-list .history-item').filter({ hasText: 'implement vector search' })).toBeVisible({
		timeout: 15000,
	});
}
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
}

async function measureDiffLayout(page: Page): Promise<DiffLayoutMetrics> {
	return page.evaluate(() => {
		const portal = document.getElementById('pierre-diff-root');
		const rows = document.getElementById('diffRows');
		const content = document.querySelector('.diff-content');
		const timeline = document.querySelector('.timeline-pane');
		const host = portal?.querySelector('diffs-container') as HTMLElement | null;
		const codes = [
			...(host?.shadowRoot?.querySelectorAll('[data-code], [data-overflow] > code, pre > code') ?? []),
		] as HTMLElement[];
		const lines = [...(host?.shadowRoot?.querySelectorAll('[data-line]') ?? [])] as HTMLElement[];
		const viewportH = Math.round(window.visualViewport?.height ?? window.innerHeight);
		const portalH = portal ? Math.round(portal.getBoundingClientRect().height) : 0;
		const hostH = host ? Math.round(host.getBoundingClientRect().height) : 0;
		const hostScrollH = host ? Math.round(host.scrollHeight) : 0;
		const rowsH = rows ? Math.round(rows.getBoundingClientRect().height) : 0;
		const contentH = content instanceof HTMLElement ? Math.round(content.getBoundingClientRect().height) : 0;
		const timelineH = timeline instanceof HTMLElement ? Math.round(timeline.getBoundingClientRect().height) : 0;
		const lineHeights = lines.map((line) => Math.round(line.getBoundingClientRect().height)).filter((h) => h > 0);
		const codeClientHeights = codes.map((c) => Math.round(c.getBoundingClientRect().height));
		const codeScrollHeights = codes.map((c) => Math.round(c.scrollHeight));
		const maxCodeScrollH = codeScrollHeights.length ? Math.max(...codeScrollHeights) : 0;
		const minCodeClientH = codeClientHeights.length ? Math.min(...codeClientHeights) : 0;
		const maxLineH = lineHeights.length ? Math.max(...lineHeights) : 0;
		const minLineH = lineHeights.length ? Math.min(...lineHeights) : 0;
		const lineCount = lines.length;
		const lineTops = lines.map((line) => line.getBoundingClientRect().top);
		const lineTopSpan = lineTops.length > 0 ? Math.round(Math.max(...lineTops) - Math.min(...lineTops)) : 0;
		const uniqueLineTops = new Set(lineTops.map((top) => Math.round(top / 2) * 2)).size;
		const isCrushed =
			portalH > 200 &&
			lineCount > 40 &&
			((hostScrollH <= portalH + 24 && lineTopSpan < Math.max(120, portalH * 0.45)) ||
				(uniqueLineTops < Math.max(8, Math.floor(lineCount * 0.2)) && lineTopSpan < portalH * 0.5));
		return {
			viewportH,
			portalH,
			hostH,
			hostScrollH,
			rowsH,
			contentH,
			timelineH,
			maxLineH,
			minLineH,
			lineCount,
			maxCodeScrollH,
			minCodeClientH,
			portalFillRatio: viewportH > 0 ? portalH / viewportH : 0,
			lineTopSpan,
			uniqueLineTops,
			isCrushed,
		};
	});
}
