import { expect, test } from '@playwright/test';

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
});

async function openFixture(page: Parameters<typeof test>[0]['page'], fixture: string) {
  await page.goto(`/?fixture=${fixture}`);
  await expect(page.getByText('Revision Timeline')).toBeVisible();
  await expect(page.locator('#diffTitle')).not.toHaveText('No diff available');
  if (fixture === 'jj-basic') {
    await expect(page.getByRole('button', { name: 'Snapshot', exact: true })).toBeVisible();
  }
}
