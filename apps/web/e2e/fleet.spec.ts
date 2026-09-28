import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The demo fleet (VD_DEMO=1, fixtures/fleet-demo.json) over the fixed e2e feed: 31 hosts on two sites.
async function noAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test('the board aggregates products over the hosts, with poll problems counted apart', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-fleet-tile]')).toHaveCount(8);
  const debian = page.locator('[data-fleet-tile="debian"]');
  await expect(debian).toContainText('10 hosts');
  await expect(debian).toContainText('1 EOL');
  await expect(page.getByRole('link', { name: /Poll problems\s*2/ })).toBeVisible();
  // Windows Server is not in the e2e feed: its versions are unknown, so a host that can't be polled is stale.
  await page.locator('[data-fleet-tile="windows-server"]').click();
  await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible();
  await expect(page.getByRole('link', { name: /kzn-fs-01/ })).toContainText('no access');
  await noAxeViolations(page);
});

test('the hosts table filters by poll problems; a host card explains the problem', async ({ page }) => {
  await page.goto('/hosts');
  await expect(page.locator('tbody tr:not(.site)')).toHaveCount(31);
  await page.getByRole('button', { name: /Poll problems/ }).click();
  await expect(page).toHaveURL(/poll=problem/);
  await expect(page.locator('tbody tr:not(.site)')).toHaveCount(2);
  await noAxeViolations(page);
  await page.getByRole('link', { name: 'kzn-fs-01' }).click();
  await expect(page.getByRole('heading', { name: /Access denied since/ })).toBeVisible();
  await expect(page.getByText('last known data')).toBeVisible();
});

test('a site filter narrows every screen and is kept in the URL', async ({ page }) => {
  await page.goto('/hosts');
  await page.getByLabel('Site:').selectOption({ label: 'Казань, филиал' });
  await expect(page).toHaveURL(/site=\d+/);
  await expect(page.locator('tbody tr:not(.site)')).toHaveCount(9);
});
