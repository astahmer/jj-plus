import { expect, test, type Page } from '@playwright/test';

test.describe('timeline interactions', () => {
	test.use({ viewport: { width: 1500, height: 1100 } });

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
