import { expect } from '@playwright/test';
import { Given, Then, When } from '../support/fixtures';

Given('I open the standalone revision timeline app for fixture {string}', async ({ page }, fixture: string) => {
  await page.goto(`/?fixture=${fixture}`);
});

Then('I should see the revision timeline header', async ({ page }) => {
  await expect(page.getByText('Revision Timeline')).toBeVisible();
});

Then('I should see a diff title for the selected revision range', async ({ page }) => {
  await expect(page.locator('#diffTitle')).not.toHaveText('No diff available');
});

When('I select the revision {string} from the sidebar', async ({ page }, value: string) => {
  await page.locator('.history-list .history-item').filter({ hasText: value }).first().click();
});

Then('the diff title should contain {string}', async ({ page }, value: string) => {
  await expect(page.locator('#diffTitle')).toContainText(value);
});

Then('the diff title should change', async ({ page }) => {
  const title = page.locator('#diffTitle');
  await expect(title).not.toHaveText('No diff available');
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
  await page.getByRole('button', { name: 'Show In-Between' }).click();
});

When('I search revisions for {string}', async ({ page }, value: string) => {
  await page.getByPlaceholder('Search revisions').fill(value);
});

Then('I should see {int} sidebar revision', async ({ page }, count: number) => {
  await expect(page.locator('.history-list .history-item')).toHaveCount(count);
});

When('I press the {string} key', async ({ page }, key: string) => {
  await page.keyboard.press(key);
});

When('I click the previous range button', async ({ page }) => {
  await page.locator('.timeline-row .step-button').nth(1).click();
});

When('I switch the layout mode to {string}', async ({ page }, value: string) => {
  await page.getByRole('button', { name: value }).click();
});

Then('the diff layout mode should be {string}', async ({ page }, value: string) => {
  await expect(page.locator('#diffRows')).toHaveAttribute('data-layout-mode', value);
});
