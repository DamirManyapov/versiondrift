import { expect, test } from '@playwright/test';

// A self-hosted instance opened by its LAN address over plain http is not a secure context: browsers hide
// crypto.subtle and navigator.clipboard there. Statuses (sha256 of product files) and copying must still work.
test('over plain http on a LAN address, statuses are computed and host names are copied', async ({
  page,
}) => {
  await page.goto('/');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  const debian = page.locator('[data-fleet-tile="debian"]');
  await expect(debian).toContainText('1 EOL');
  await expect(debian).not.toContainText('unknown');
  await debian.click();
  await page.getByRole('button', { name: 'Copy hosts for a ticket' }).first().click();
  await expect(page.getByText(/^Copied \d+ host names?\.$/)).toBeVisible();
});
