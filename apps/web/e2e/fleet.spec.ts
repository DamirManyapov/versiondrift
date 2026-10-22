import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The demo fleet (VD_DEMO=1, fixtures/fleet-demo.json) over the fixed e2e feed: 31 hosts on two sites.
// One server for the file and the last test adds hosts: run in order.
test.describe.configure({ mode: 'serial' });
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
  await expect(page.getByRole('link', { name: /Poll problems: 2 hosts/ })).toBeVisible();
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

test('poll now: one host from its card, several from the table; select-all takes only filtered rows', async ({
  page,
}) => {
  await page.goto('/hosts?poll=problem');
  await page.getByRole('checkbox', { name: 'Select all 2 shown' }).check();
  await expect(page.getByRole('region', { name: '2 hosts selected' })).toBeVisible();
  await page.getByRole('link', { name: 'kzn-fs-01' }).click();
  await page.getByRole('button', { name: 'Poll now' }).click();
  await expect(page.getByRole('status')).toContainText('Poll of kzn-fs-01: no access.');

  await page.goto('/hosts');
  await page.getByRole('checkbox', { name: 'Select msk-app-01' }).check();
  await page.getByRole('checkbox', { name: 'Select msk-app-02' }).check();
  await page.getByRole('button', { name: 'Poll now' }).click();
  await expect(page.getByRole('status')).toContainText('Polled 2 hosts.');
});

test('add hosts: one through the form, a list through the CSV dry run', async ({ page }) => {
  await page.goto('/hosts');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: /^Host\b/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Add hosts' });
  await dialog.getByLabel('Name').fill('e2e-one');
  await dialog.getByLabel('Address').fill('10.0.0.5');
  await dialog.getByRole('button', { name: 'Save and check the connection' }).click();
  await expect(dialog.getByRole('status')).toContainText('e2e-one added. e2e-one polled');

  await dialog.getByRole('tab', { name: 'From a CSV list' }).click();
  await dialog
    .getByLabel('List')
    .fill(
      'name,address,site,profile\ne2e-two,10.0.0.6,Lab,Windows RO\nbad name,10.0.0.7,Lab,Windows RO\ne2e-one,10.0.0.5,"Москва, ЦОД",Linux SSH (только чтение)',
    );
  await dialog.getByRole('button', { name: 'Check the list' }).click();
  await expect(dialog.getByText('1 new')).toBeVisible();
  await expect(dialog.getByText('1 already there')).toBeVisible();
  await expect(dialog.getByText('1 error')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add 1 host' }).click();
  await expect(dialog.getByRole('status').last()).toContainText('1 host added or changed.');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page).not.toHaveURL(/add=/);
  await expect(page.locator('tbody tr:not(.site)')).toHaveCount(33);
});

test('a new access profile: type, instructions to copy, details, test on a host', async ({ page }) => {
  await page.goto('/access-profiles');
  await page.getByRole('link', { name: '+ New profile' }).click();
  await page.getByRole('button', { name: /MikroTik/ }).click();
  await expect(page.getByText('/user group add name=vd-read policy=read,ssh')).toBeVisible();
  await expect(page.getByText(/address=localhost\/32/)).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Profile name').fill('MikroTik e2e');
  await page.getByLabel('Password').fill('secret-e2e');
  await page.getByRole('button', { name: 'Save the profile' }).click();
  await expect(page.getByText('Profile “MikroTik e2e” saved.')).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Test on a host' })
    .selectOption({ label: 'msk-gw-01 · 10.10.0.1' });
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByRole('status').last()).toContainText('It works. Found: MikroTik RouterOS 7.23.7.');

  await page.goto('/access-profiles/new?type=linux&step=3');
  await page.getByLabel('Profile name').fill('Linux e2e');
  await page.getByRole('button', { name: 'Save the profile' }).click();
  await expect(
    page.getByText(/restrict,command="\/usr\/local\/bin\/versiondrift-inventory" ssh-ed25519 AAAA/),
  ).toBeVisible();
});

test('a host card edits the address with a port and checks the host again', async ({ page }) => {
  await page.goto('/hosts');
  await page.getByRole('link', { name: 'kzn-fs-01' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const form = page.getByRole('form', { name: 'Edit' });
  await form.getByLabel('Address').fill('10.20.2.99:2026');
  await form.getByRole('button', { name: 'Save and check the connection' }).click();
  await expect(form).toBeHidden();
  await expect(page.locator('dd', { hasText: '10.20.2.99:2026' })).toBeVisible();
});

test('a product the detectors cannot see is added to a host by hand, and removed', async ({ page }) => {
  await page.goto('/hosts');
  await page.getByRole('link', { name: 'kzn-fs-01' }).click();
  await page.getByRole('button', { name: 'Add a product by hand' }).click();
  const form = page.getByRole('form', { name: 'Add a product by hand' });
  await form.getByLabel('Product').fill('Zabbix');
  await form.getByLabel('Version').fill('7.0.0');
  await form.getByRole('button', { name: 'Save' }).click();
  const row = page.locator('tr', { hasText: 'Zabbix' });
  await expect(row).toContainText('7.0.0');
  await expect(row).toContainText('entered by hand');
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(row).toHaveCount(0);
});

test('a product without a host is added from the catalog to a site and given a version, like on the public site', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Site:').selectOption({ label: 'Казань, филиал' });
  const hostless = page.locator('section.hostless');
  await expect(hostless.getByRole('heading', { name: 'Without a host' })).toBeVisible();
  await hostless.getByRole('link', { name: 'Add a product' }).click();
  await expect(page.getByLabel('Add to site:').locator('option:checked')).toHaveText('Казань, филиал');
  await page.getByRole('searchbox').fill('zabbix');
  const row = page.locator('li', { hasText: 'Zabbix' });
  await row.getByRole('button', { name: 'Add' }).click();
  await expect(row).toContainText('Added');

  await page.goto('/');
  const tile = hostless.locator('[data-tile]', { hasText: 'Zabbix' });
  await tile.click();
  // The board has one detail panel, on the right, for fleet and host-less products alike.
  const version = page.getByRole('combobox', { name: 'My version' });
  await version.fill('7.0.0');
  await version.press('Enter');
  await expect(tile).not.toContainText('No version');

  // "All sites": every site's products without a host, read-only, labelled with the site.
  await page.getByLabel('Site:').selectOption({ label: 'All sites' });
  await expect(hostless.locator('[data-tile]', { hasText: 'Zabbix' })).toContainText('Казань, филиал');
  await hostless.locator('[data-tile]', { hasText: 'Zabbix' }).click();
  await expect(page.getByRole('combobox', { name: 'My version' })).toHaveCount(0);
  await expect(
    page.locator('[aria-pressed="true"][data-tile], [aria-pressed="true"][data-fleet-tile]'),
  ).toHaveCount(1);
});

test('a new site is made from the site switcher; Settings list sites and keep ones with hosts', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Site:').selectOption({ label: '+ New site…' });
  await page.getByRole('textbox', { name: 'Name of the new site' }).fill('Lab 3');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/site=\d+/);
  await expect(page.getByLabel('Site:')).toHaveValue(/^\d+$/);
  await expect(page.getByLabel('Site:').locator('option:checked')).toHaveText('Lab 3');

  await page.goto('/settings/sites');
  const sites = page.locator('section', { has: page.getByRole('heading', { name: 'Sites' }) });
  await expect(sites.locator('li', { hasText: 'Lab 3' })).toContainText('0 hosts');
  const kazan = sites.locator('li', { hasText: 'Казань, филиал' });
  await expect(kazan).toContainText('has hosts');
  await expect(kazan.getByRole('button', { name: 'Delete board' })).toHaveCount(0);
});
