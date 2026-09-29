import { expect, test } from '@playwright/test';

test('boards live on the server: create one, add a product, find it through the API', async ({
  page,
  request,
}) => {
  const name = `Lab ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'See how far your stack has drifted from upstream.' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '+ New board' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  // "Main" is empty too: wait for the new board itself before leaving the page.
  await expect(page.getByLabel('Board', { exact: true }).locator('option:checked')).toHaveText(name);
  await expect(page.getByRole('heading', { name: 'Your board is empty' })).toBeVisible();

  await page.goto('/p/debian');
  await page.getByRole('button', { name: 'Add to my board' }).click();
  await page.goto('/');
  await expect(page.locator('[data-tile]')).toHaveCount(1);
  await expect(page.getByLabel('Board', { exact: true }).locator('option:checked')).toHaveText(name);

  const { boards } = (await (await request.get('/api/boards')).json()) as {
    boards: { id: number; name: string }[];
  };
  const board = boards.find((b) => b.name === name)!;
  const inventory = (await (await request.get(`/api/boards/${board.id}/inventory`)).json()) as {
    items: unknown[];
  };
  expect(inventory.items).toEqual([{ p: 'debian' }]);
});

test('a board is renamed and deleted from the board switcher', async ({ page }) => {
  const name = `Lab ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto('/');
  await page.getByRole('button', { name: '+ New board' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  const current = page.getByLabel('Board', { exact: true }).locator('option:checked');
  await expect(current).toHaveText(name);

  await page.getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill(`${name} 2`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(current).toHaveText(`${name} 2`);

  await page.getByRole('button', { name: 'Delete board' }).click();
  await page.getByRole('button', { name: `Delete “${name} 2” and everything on it` }).click();
  await expect(page.getByLabel('Board', { exact: true }).locator('option', { hasText: name })).toHaveCount(0);
});

test('settings offer boards and notification channels; the feed copy is served locally', async ({
  page,
  request,
}) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  const index = await request.get('/feed/v1/index.json');
  expect(index.ok()).toBe(true);
  expect(index.headers()['access-control-allow-origin']).toBe('*');
  expect((await request.get('/', { maxRedirects: 0 })).headers()['x-robots-tag']).toBe('noindex, nofollow');
});

test('settings → feed: an upload that is not a feed package is refused with the reason', async ({ page }) => {
  await page.goto('/settings');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Feed' }) });
  await expect(section.getByRole('button', { name: 'Check for updates' })).toBeVisible();
  await section.getByLabel('Upload an offline package…').setInputFiles({
    name: 'versiondrift-feed.tar.gz',
    mimeType: 'application/gzip',
    buffer: Buffer.from('not a package'),
  });
  await expect(section.getByRole('alert')).toContainText('not a VersionDrift feed package');
});
