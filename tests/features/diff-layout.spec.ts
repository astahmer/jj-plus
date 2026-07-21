import { expect, test, type Page } from '@playwright/test';

type DiffLayoutMetrics = {
	viewportH: number;
	portalH: number;
	rowsH: number;
	contentH: number;
	timelineH: number;
	maxLineH: number;
	portalFillRatio: number;
	rowsFillRatio: number;
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
		expect(layout.rowsFillRatio).toBeGreaterThan(0.4);
		expect(layout.maxLineH).toBeLessThan(40);
		// Portal must not leave a large empty void under a short strip.
		expect(layout.portalH).toBeGreaterThanOrEqual(layout.rowsH - 8);
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
		expect(focused.maxLineH).toBeLessThan(40);
		expect(focused.portalH).toBeGreaterThanOrEqual(focused.rowsH - 8);
	});

	test('git fixture also keeps a tall scrollable diff surface', async ({ page }) => {
		await openFixture(page, 'git-basic');

		const layout = await measureDiffLayout(page);
		expect(layout.portalH).toBeGreaterThan(layout.viewportH * 0.4);
		expect(layout.rowsH).toBeGreaterThan(layout.viewportH * 0.4);
		expect(layout.maxLineH).toBeLessThan(40);

		await page.getByRole('button', { name: 'Focus diff' }).click();
		await expect.poll(async () => (await measureDiffLayout(page)).portalFillRatio).toBeGreaterThan(0.7);
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
}

async function measureDiffLayout(page: Page): Promise<DiffLayoutMetrics> {
	return page.evaluate(() => {
		const portal = document.getElementById('pierre-diff-root');
		const rows = document.getElementById('diffRows');
		const content = document.querySelector('.diff-content');
		const timeline = document.querySelector('.timeline-pane');
		const container = portal?.querySelector('diffs-container');
		const lines = [...(container?.shadowRoot?.querySelectorAll('[data-line]') ?? [])] as HTMLElement[];
		const viewportH = Math.round(window.visualViewport?.height ?? window.innerHeight);
		const portalH = portal ? Math.round(portal.getBoundingClientRect().height) : 0;
		const rowsH = rows ? Math.round(rows.getBoundingClientRect().height) : 0;
		const contentH = content instanceof HTMLElement ? Math.round(content.getBoundingClientRect().height) : 0;
		const timelineH = timeline instanceof HTMLElement ? Math.round(timeline.getBoundingClientRect().height) : 0;
		return {
			viewportH,
			portalH,
			rowsH,
			contentH,
			timelineH,
			maxLineH: Math.max(0, ...lines.map((line) => Math.round(line.getBoundingClientRect().height))),
			portalFillRatio: viewportH > 0 ? portalH / viewportH : 0,
			rowsFillRatio: viewportH > 0 ? rowsH / viewportH : 0,
		};
	});
}
