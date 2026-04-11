import { expect } from '@playwright/test';
import { Given, Then, When } from '../support/fixtures';

Given('I open the standalone revision timeline app', async ({ page }) => {
  await page.goto('/');
});

Then('I should see the revision timeline header', async ({ page }) => {
  await expect(page.getByText('Revision Timeline')).toBeVisible();
});

Then('I should see a diff title for the selected revision range', async ({ page }) => {
  await expect(page.locator('#diffTitle')).toContainText('/');
});

When('I select the revision {string} from the sidebar', async ({ page }, value: string) => {
  await page.locator('.history-list .history-item').filter({ hasText: value }).first().click();
});

Then('the diff title should contain {string}', async ({ page }, value: string) => {
  await expect(page.locator('#diffTitle')).toContainText(value);
});

Then('I should see the range count {string}', async ({ page }, value: string) => {
  await expect(page.getByText(value)).toBeVisible();
});

When('I toggle the in-between revisions filter', async ({ page }) => {
  await page.getByRole('button', { name: 'Show In-Between' }).click();
});

When('I switch the layout mode to {string}', async ({ page }, value: string) => {
  await page.getByRole('button', { name: value }).click();
});

Then('the diff layout mode should be {string}', async ({ page }, value: string) => {
  await expect(page.locator('#diffRows')).toHaveAttribute('data-layout-mode', value);
});
