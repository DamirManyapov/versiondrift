import { expect, test } from '@playwright/test';

// The fleet board on a phone (UI audit P2): a ~60px header, the views in a bottom tab bar, no sideways scrolling,
// every target at least 44px, and the detail panel as a full-screen layer with "← Back".
test('on a phone the views are a tab bar, targets are 44px and the panel opens over the board', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-fleet-tile]').first()).toBeVisible();
  expect((await page.locator('header').first().boundingBox())!.height).toBeLessThanOrEqual(64);
  const tabbar = page.locator('nav.tabbar');
  await expect(tabbar).toBeVisible();
  await expect(tabbar.getByRole('link', { name: 'Hosts' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const small = await page.$$eval(
    'main button, main a.btn, main select, header button, .tabbar a',
    (els) =>
      els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.height < 44)
        .length,
  );
  expect(small).toBe(0);

  await page.locator('[data-fleet-tile]').first().click();
  const back = page.getByRole('button', { name: /Back/ });
  await expect(back).toBeFocused();
  await back.click();
  await expect(back).toBeHidden();
});
