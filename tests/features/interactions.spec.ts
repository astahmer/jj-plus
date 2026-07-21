import { expect, test, type Page } from '@playwright/test';

test.describe('timeline interactions', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

	test('selection diff actions show known diff counts', async ({ page }) => {
		await openFixture(page, 'jj-basic');

		await expect(page.locator('#openSidebarRangeDiffButton')).toContainText('Open selection diffs (1)');
		await expect(page.locator('#actionsButton')).toBeVisible();
		await page.locator('#actionsButton').click();
		await expect(page.locator('#openRangeFilesButton')).toContainText('Open multi-file diffs (1)');
		await expect(
			sidebarRevision(page, 'plan refinement').getByRole('button', { name: /Open multi-file diffs \(1\)/ }),
		).toBeVisible();
	});

	test('jj rename history keeps the pre-rename revision visible', async ({ page }) => {
		await openFixture(page, 'jj-rename');

		await expect(page.locator('.history-list .history-item')).toHaveCount(3);
		await expect(sidebarRevision(page, 'initial commitment file')).toBeVisible();
		await expect(sidebarRevision(page, 'rename packages to apps')).toBeVisible();
		await expect(sidebarRevision(page, 'update commitment after rename')).toBeVisible();
		await expect(
			page.locator('.history-list .history-item').last().locator('.history-bottom .mini-badge.introduced'),
		).toBeVisible();

		await sidebarRevision(page, 'initial commitment file').click();
		await expect(sidebarRevision(page, 'initial commitment file')).toBeVisible();
	});

	test('sidebar markers show labels without type prefixes', async ({ page }) => {
		await openFixture(page, 'jj-basic');

		const markerRow = sidebarRevision(page, 'service extraction');
		await expect(markerRow).toContainText('main');
		await expect(markerRow.locator('.timeline-marker-prefix')).toHaveCount(0);
	});

	test('modifier-free letter hotkeys stay inert while an input is focused', async ({ page }) => {
		await openFixture(page, 'git-basic');

		const workspace = page.locator('.workspace');
		const fromInput = page.locator('#fromRevisionInput');
		const fileSwitcher = page.locator('#fileSwitcher');

		await fromInput.focus();
		await page.keyboard.press('t');
		await expect(fromInput).toBeFocused();
		await expect(page.locator('#toRevisionInput')).not.toBeFocused();

		await fileSwitcher.focus();
		await page.keyboard.press('b');
		await expect(fileSwitcher).toBeFocused();
		await expect(workspace).not.toHaveClass(/is-collapsed/);
	});

	test('shortcut-focused inputs stop chaining once the user starts typing', async ({ page }) => {
		await openFixture(page, 'git-basic');

		const fileSwitcher = page.locator('#fileSwitcher');
		await page.keyboard.press('/');
		await expect(fileSwitcher).toBeFocused();

		await page.keyboard.press('x');
		await page.keyboard.press('f');

		await expect(fileSwitcher).toBeFocused();
		await expect(page.locator('#fromRevisionInput')).not.toBeFocused();
	});

	test('revision handle pills focus the matching sidebar entries', async ({ page }) => {
		await openFixture(page, 'git-basic');

		await page.locator('#fromHandleLabel').click();
		await expect.poll(async () => activeEntryIndex(page)).toBe('4');

		await page.locator('#toHandleLabel').click();
		await expect.poll(async () => activeEntryIndex(page)).toBe('5');
	});

	test('selection diff payload follows the visible entries when in-between revisions are toggled', async ({ page }) => {
		await openFixture(page, 'git-basic');

		await sidebarRevision(page, '235489e2').click();
		await sidebarRevision(page, 'Current').click();
		await page.locator('#openSidebarRangeDiffButton').click();
		await expect
			.poll(async () => String((await getLastAction(page))?.payload.selectedEntryIndexes || ''))
			.toBe('1,2,3,4,5');

		await page.locator('#intermediateToggle').click();
		await page.locator('#openSidebarRangeDiffButton').click();
		await expect
			.poll(async () => String((await getLastAction(page))?.payload.selectedEntryIndexes || ''))
			.toBe('2,4,5');
	});

	test('dragging from a track anchor moves the range instead of starting pending selection', async ({ page }) => {
		await openFixture(page, 'git-basic');

		await sidebarRevision(page, '972dd9e5').click();
		await sidebarRevision(page, 'b671cdd4').click();
		const initialFromLabel = await page.locator('#fromHandleLabel').textContent();

		const anchor = page.locator('.track-anchor').nth(2);
		const anchorBox = await anchor.boundingBox();
		expect(anchorBox).not.toBeNull();
		if (!anchorBox) {
			return;
		}

		await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(anchorBox.x + anchorBox.width / 2 + 220, anchorBox.y + anchorBox.height / 2, {
			steps: 4,
		});
		await page.mouse.up();

		await expect(page.locator('#selectionMeta')).not.toContainText('Pick another revision to complete the range.');
		await expect(page.locator('#fromHandleLabel')).not.toHaveText(initialFromLabel || '');
	});

	test('range tooltips switch into pending-selection mode while hovering the track', async ({ page }) => {
		await openFixture(page, 'git-basic');

		const anchors = page.locator('.track-anchor');
		const anchorCount = await anchors.count();
		expect(anchorCount).toBeGreaterThan(4);

		await anchors.nth(1).click();

		const trackBox = await page.locator('#track').boundingBox();
		expect(trackBox).not.toBeNull();
		if (!trackBox) {
			return;
		}

		await page.mouse.move(trackBox.x + trackBox.width * 0.72, trackBox.y + trackBox.height * 0.5);
		const tooltipLabel = page.locator('.anchor-tooltip-label').last();
		await expect(tooltipLabel).toContainText('Pending selection');
		await expect(tooltipLabel).toContainText('revisions');

		await anchors.nth(4).dispatchEvent('mouseenter');
		await expect(tooltipLabel).toContainText('Pending selection');
		await expect(tooltipLabel).not.toContainText('Segment preview');
	});

	test('segment tooltips keep the revision count but drop the old prefix', async ({ page }) => {
		await openFixture(page, 'git-basic');

		const trackBox = await page.locator('#track').boundingBox();
		expect(trackBox).not.toBeNull();
		if (!trackBox) {
			return;
		}

		await page.mouse.move(trackBox.x + trackBox.width * 0.62, trackBox.y + trackBox.height * 0.5);
		const tooltipLabel = page.locator('.anchor-tooltip-label').last();
		await expect(tooltipLabel).toHaveText(/\d+ revisions?/);
		await expect(tooltipLabel).not.toContainText('Segment preview');
	});

	test('top-changed mode loads a repo overview summary for the current range', async ({ page }) => {
		await openFixture(page, 'git-basic');

		await page.getByRole('button', { name: 'Top changed', exact: true }).click();
		const overviewSummary = page.locator('.file-switcher-summary');
		await expect(overviewSummary).toBeVisible();
		await expect(overviewSummary).not.toHaveText('');
	});
});

async function openFixture(page: Page, fixture: string) {
	await page.goto(`/?fixture=${fixture}`);
	await expect(page.getByText('Revision Timeline')).toBeVisible();
	await expect(page.locator('#diffTitle')).not.toHaveText('No diff available');
}

function sidebarRevision(page: Page, value: string) {
	return page.locator('.history-list .history-item').filter({ hasText: value }).first();
}

async function activeEntryIndex(page: Page) {
	return page.evaluate(() => document.activeElement?.getAttribute('data-entry-index') || null);
}

async function getLastAction(page: Page) {
	return page.evaluate(() => window.__TIMELINE_TEST_STATE__?.lastAction || null);
}
