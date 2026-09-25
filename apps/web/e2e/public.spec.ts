import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function noAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test('a first visit shows what VersionDrift is and a sample board', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'See how far your stack has drifted from upstream.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Grafana/ })).toBeVisible();
  await expect(page.locator('[data-tile]')).toHaveCount(9);
  await page.getByRole('button', { name: /Grafana/ }).click();
  await expect(page.getByRole('heading', { name: 'Grafana', level: 2 })).toBeVisible();
  await noAxeViolations(page);
});

test('the board is kept in the browser and can be shared read-only', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start my own board' }).click();
  await expect(page.getByRole('heading', { name: 'Your board is empty' })).toBeVisible();

  await page.goto('/p/nginx');
  await page.getByRole('button', { name: 'Add to my board' }).click();
  await page.goto('/');
  await page.getByRole('combobox', { name: 'My version' }).fill('1.26.2');
  await page.getByRole('combobox', { name: 'My version' }).press('Enter');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'My version' })).toHaveValue('1.26.2');

  await page.getByRole('button', { name: 'Share' }).click();
  const link = page.getByRole('textbox', { name: 'Share link' });
  await expect(link).toHaveValue(/\/b#nginx@1\.26\.2$/);
  const shared = await context.newPage();
  await shared.goto(await link.inputValue());
  await expect(shared.getByRole('note')).toContainText('A shared board with 1 product');
  await expect(shared.getByRole('combobox', { name: 'My version' })).toHaveCount(0);
});

test('product, compare and version pages are server-rendered with canonical URLs', async ({
  page,
  request,
}) => {
  const product = await request.get('/p/grafana');
  expect(product.ok()).toBe(true);
  expect(await product.text()).toContain('<link rel="canonical"');

  const reversed = await request.get('/p/grafana/99.0.0...1.0.0', { maxRedirects: 0 });
  expect(reversed.status()).toBe(404);

  await page.goto('/p/grafana');
  const release = page.locator('a.ver').nth(3);
  const version = (await release.innerText()).trim();
  await release.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Is Grafana ${version} affected?`);
  await noAxeViolations(page);

  const compare = page.getByRole('link', { name: /^What changed up to/ });
  await compare.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Grafana ${version} →`);
  await noAxeViolations(page);
});

test('the catalog finds products and the feeds and sitemap answer', async ({ page, request }) => {
  await page.goto('/catalog');
  await page.getByRole('searchbox').fill('postgres');
  await expect(page.getByText('PostgreSQL', { exact: true })).toBeVisible();
  for (const url of ['/rss/p/grafana.xml', '/rss/week.xml', '/sitemap.xml', '/healthz']) {
    expect((await request.get(url)).ok(), url).toBe(true);
  }
  expect((await request.get('/api/boards')).status()).toBe(404);
});
