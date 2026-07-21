import { expect, type Page } from '@playwright/test';
import { Given, Then, When } from '../support/fixtures';

Given('I open the standalone revision timeline app for fixture {string}', async ({ page }, fixture: string) => {
	await page.goto(`/?fixture=${fixture}`);
	await expect(page.getByText('Revision Timeline')).toBeVisible();
});

Then('I should see the revision timeline header', async ({ page }) => {
	await expect(page.getByText('Revision Timeline')).toBeVisible();
});

Then('I should see a diff title for the selected revision range', async ({ page }) => {
	await expect(page.locator('#diffTitle')).not.toHaveText('No diff available');
});

When('I select the revision {string} from the sidebar', async ({ page }, value: string) => {
	await sidebarRevision(page, value).click();
});

Then('the diff title should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('#diffTitle')).toContainText(value);
});

Then('I should see the range count {string}', async ({ page }, value: string) => {
	await expect(page.getByText(value)).toBeVisible();
});

Then('the range count should stay at 2 selected revisions', async ({ page }) => {
	await expect(page.locator('.range-subtitle')).toContainText(/^2\//);
});

Then('I should see the backend label {string}', async ({ page }, value: string) => {
	await expect(page.locator('.range-label')).toContainText(value);
});

When('I toggle the in-between revisions filter', async ({ page }) => {
	await page.locator('#intermediateToggle').click();
});

When('I search revisions for {string}', async ({ page }, value: string) => {
	await page.locator('#sidebarSearchInput').fill(value);
});

Then('I should see {int} sidebar revision', async ({ page }, count: number) => {
	await expect(page.locator('.history-list .history-item')).toHaveCount(count);
});

Then('I should see {int} sidebar revisions', async ({ page }, count: number) => {
	await expect(page.locator('.history-list .history-item')).toHaveCount(count);
});

When('I press the {string} key', async ({ page }, key: string) => {
	await page.keyboard.press(normalizeKey(key));
});

When('I dispatch the timeline shortcut {string}', async ({ page }, key: string) => {
	const normalized = normalizeKey(key);
	await page.evaluate((combo) => {
		const parts = combo.split('+');
		const keyName = parts.at(-1) || '';
		const event = new KeyboardEvent('keydown', {
			key: keyName,
			code: keyName,
			metaKey: parts.includes('Meta'),
			ctrlKey: parts.includes('Control') || parts.includes('Ctrl'),
			altKey: parts.includes('Alt'),
			shiftKey: parts.includes('Shift'),
			bubbles: true,
			cancelable: true,
		});
		window.dispatchEvent(event);
	}, normalized);
});

When('I click the previous range button', async ({ page }) => {
	await page.locator('#stepBackwardButton').click();
});

When('I click the next range button', async ({ page }) => {
	await page.locator('#stepForwardButton').click();
});

When('I switch the layout mode to {string}', async ({ page }, value: string) => {
	await page.getByRole('button', { name: value }).click();
});

Then('the diff layout mode should be {string}', async ({ page }, value: string) => {
	await expect(page.locator('#diffRows')).toHaveAttribute('data-layout-mode', value);
});

When('I switch the comparison source to {string}', async ({ page }, value: string) => {
	await page.getByRole('button', { name: value, exact: true }).click();
});

When('I switch the comparison mode to {string}', async ({ page }, value: string) => {
	await page.getByRole('button', { name: value, exact: true }).click();
});

When('I switch the content mode to {string}', async ({ page }, value: string) => {
	await page.getByRole('button', { name: value, exact: true }).click();
});

When('I submit {string} into the {string} picker', async ({ page }, value: string, picker: string) => {
	const input = page.locator(picker === 'From revision' ? '#fromRevisionInput' : '#toRevisionInput');
	await input.fill('');
	await input.type(value);
	await input.press('Enter');
});

When('I open the actions menu', async ({ page }) => {
	await page.locator('#actionsButton').click();
	await expect(page.locator('#actionsMenu')).toBeVisible();
});

When('I choose the action menu item {string}', async ({ page }, value: string) => {
	await ensureActionsMenuVisible(page);
	await page
		.locator('#actionsMenu')
		.getByRole('button', { name: buttonNamePattern(value) })
		.click();
});

When('I click the {string} row action for revision {string}', async ({ page }, action: string, revision: string) => {
	await sidebarRevision(page, revision)
		.getByRole('button', { name: buttonNamePattern(action) })
		.click();
});

When('I click the sidebar open diff button', async ({ page }) => {
	await page.locator('#openSidebarRangeDiffButton').click();
});

When('I switch to file {string}', async ({ page }, relativePath: string) => {
	const switcher = page.locator('#fileSwitcher');
	await switcher.click();
	await switcher.fill('');
	await switcher.type(relativePath);
	await switcher.press('Enter');
	await page.waitForFunction((path) => window.__TIMELINE_TEST_STATE__?.activeRelativePath === path, relativePath);
});

When('I click the timeline collapse button', async ({ page }) => {
	await page.locator('#toggleTimelinePaneButton').click();
});

When('I click the diff focus button', async ({ page }) => {
	await page.locator('#toggleDiffFocusButton').click();
});

When('I select the preset {string}', async ({ page }, value: string) => {
	await page.getByRole('button', { name: value, exact: true }).click();
});

When('I reload the page', async ({ page }) => {
	await page.reload();
	await expect(page.getByText('Revision Timeline')).toBeVisible();
});

Then('the selection meta should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('#selectionMeta')).toContainText(value);
});

Then('the selection meta should not contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('#selectionMeta')).not.toContainText(value);
});

Then('the diff mode eyebrow should contain {string}', async ({ page }, value: string) => {
	await expect
		.poll(async () => {
			const text = await page.locator('#diffModeEyebrow').textContent();
			return text?.trim().toLowerCase() || '';
		})
		.toContain(value.toLowerCase());
});

Then('the diff content mode should be {string}', async ({ page }, value: string) => {
	await expect(page.locator('#diffRows')).toHaveAttribute('data-content-mode', value);
});

Then('the step status should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('#stepStatus')).toContainText(value);
});

Then('the hotkeys popover should be visible', async ({ page }) => {
	await expect(page.locator('#hotkeysPopover')).toBeVisible();
});

Then('the hotkeys popover should be hidden', async ({ page }) => {
	await expect(page.locator('#hotkeysPopover')).toHaveCount(0);
});

Then('the workspace should be collapsed', async ({ page }) => {
	await expect(page.locator('.workspace')).toHaveClass(/is-collapsed/);
});

Then('the workspace should not be collapsed', async ({ page }) => {
	await expect(page.locator('.workspace')).not.toHaveClass(/is-collapsed/);
});

Then('the workspace should be in diff focus mode', async ({ page }) => {
	await expect(page.locator('.workspace')).toHaveClass(/is-diff-focus/);
});

Then('the workspace should not be in diff focus mode', async ({ page }) => {
	await expect(page.locator('.workspace')).not.toHaveClass(/is-diff-focus/);
});

Then('the timeline pane should be collapsed', async ({ page }) => {
	await expect(page.locator('#timelinePane')).toHaveClass(/is-collapsed/);
});

Then('the focused element should be {string}', async ({ page }, id: string) => {
	await expect.poll(async () => page.evaluate(() => document.activeElement?.id || null)).toBe(id);
});

Then('the button {string} should be active', async ({ page }, value: string) => {
	await expect(buttonByName(page, value)).toHaveClass(/active/);
});

Then('the button {string} should not be active', async ({ page }, value: string) => {
	await expect(buttonByName(page, value)).not.toHaveClass(/active/);
});

Then('the button {string} should not be visible', async ({ page }, value: string) => {
	await expect(buttonByName(page, value)).toHaveCount(0);
});

Then('the in-between toggle should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('#intermediateToggle')).toContainText(value);
});

Then('the last host action should be {string}', async ({ page }, command: string) => {
	await expect.poll(async () => (await getTestState(page))?.lastAction?.command || null).toBe(command);
});

Then(
	'the last host action payload should include {string} as {string}',
	async ({ page }, field: string, value: string) => {
		await expect
			.poll(async () => {
				const payload = (await getTestState(page))?.lastAction?.payload || {};
				const actual = Reflect.get(payload, field);
				return actual == null ? null : String(actual);
			})
			.toBe(value);
	},
);

Then('the active fixture file should be {string}', async ({ page }, relativePath: string) => {
	await expect.poll(async () => (await getTestState(page))?.activeRelativePath || null).toBe(relativePath);
});

Then('the file switcher value should be {string}', async ({ page }, value: string) => {
	await expect(page.locator('#fileSwitcher')).toHaveValue(value);
});

Then('the diff rows should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('#pierre-diff-root')).toContainText(value);
});

When('I click timeline anchor {int}', async ({ page }, index: number) => {
	await page.locator('.track-anchor').nth(index).click();
});

When('I hover timeline anchor {int}', async ({ page }, index: number) => {
	const locator = page.locator('.track-anchor').nth(index);
	const box = await locator.boundingBox();
	if (!box) {
		throw new Error(`Timeline anchor ${index} has no bounding box.`);
	}

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
});

Then('the range tooltip should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('.anchor-tooltip')).toContainText(value);
});

When('I toggle the sidebar sort order', async ({ page }) => {
	await page.locator('#toggleSidebarOrderButton').click();
});

Then('the first sidebar revision should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('.history-list .history-item').first()).toContainText(value);
});

Then('the last sidebar revision should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('.history-list .history-item').last()).toContainText(value);
});

Then('the from handle label should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('#fromHandleLabel')).toContainText(value);
});

Then('the to handle label should contain {string}', async ({ page }, value: string) => {
	await expect(page.locator('#toHandleLabel')).toContainText(value);
});

When('I click the fast forward range button', async ({ page }) => {
	await page.locator('#stepFastForwardButton').click();
});

When('I click the fast backward range button', async ({ page }) => {
	await page.locator('#stepFastBackwardButton').click();
});

When('I click the hotkeys button', async ({ page }) => {
	await page.locator('#toggleHotkeysButton').click();
});

When('I click the close hotkeys button', async ({ page }) => {
	await page.locator('#closeHotkeysButton').click();
});

Then('the actions menu should be visible', async ({ page }) => {
	await expect(page.locator('#actionsMenu')).toBeVisible();
});

Then('the actions menu should be hidden', async ({ page }) => {
	await expect(page.locator('#actionsMenu')).not.toBeVisible();
});

Then('I should see the sidebar revision {string}', async ({ page }, value: string) => {
	await expect(sidebarRevision(page, value)).toBeVisible();
});

Then('the newest sidebar revision should show an introduced badge', async ({ page }) => {
	await expect(
		page.locator('.history-list .history-item').last().locator('.history-bottom .mini-badge.introduced'),
	).toBeVisible();
});

When('I switch the file switcher mode to {string}', async ({ page }, value: string) => {
	await page.getByRole('button', { name: value, exact: true }).click();
});

Then('the file switcher summary should be visible', async ({ page }) => {
	await expect(page.locator('.file-switcher-summary')).toBeVisible();
	await expect(page.locator('.file-switcher-summary')).not.toHaveText('');
});

Then('the file switcher summary should be hidden', async ({ page }) => {
	await expect(page.locator('.file-switcher-summary')).toHaveCount(0);
});

Then('the diff panel should show addition stats', async ({ page }) => {
	await expect(page.locator('.diff-summary .stat--plus').first()).toBeVisible();
});

Then('the diff panel should show deletion stats', async ({ page }) => {
	await expect(page.locator('.diff-summary .stat--minus').first()).toBeVisible();
});

When('I click the sidebar toggle button', async ({ page }) => {
	await page.locator('#sidebarToggleButton').click();
});

When('I drag the to marker toward the end of the track', async ({ page }) => {
	const marker = page.locator('#toMarker');
	const track = page.locator('#track');
	const markerBox = await marker.boundingBox();
	const trackBox = await track.boundingBox();
	if (!markerBox || !trackBox) {
		throw new Error('Missing bounding box for to-marker drag.');
	}

	const startX = markerBox.x + markerBox.width / 2;
	const startY = markerBox.y + markerBox.height / 2;
	const endX = trackBox.x + trackBox.width - 4;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(endX, startY, { steps: 6 });
	await page.mouse.up();
});

function sidebarRevision(page: Page, value: string) {
	return page.locator('.history-list .history-item').filter({ hasText: value }).first();
}

function normalizeKey(key: string) {
	return key === '?' ? 'Shift+/' : key;
}

async function getTestState(page: Page) {
	return page.evaluate(() => window.__TIMELINE_TEST_STATE__ || null);
}

function buttonByName(page: Page, value: string) {
	if (value === 'Show In-Between' || value === 'Hide In-Between') {
		return page.locator('#intermediateToggle');
	}

	return page.getByRole('button', { name: value, exact: true });
}

async function ensureActionsMenuVisible(page: Page) {
	const menu = page.locator('#actionsMenu');
	if (await menu.isVisible()) {
		return;
	}

	await page.locator('#actionsButton').click();
	await expect(menu).toBeVisible();
}

function buttonNamePattern(value: string) {
	return new RegExp(`^${escapeRegExp(value)}(?: \\([0-9]+\\))?$`);
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
