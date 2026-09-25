import { expect, test } from '@playwright/test';

test('boards live on the server: create one, add a product, find it through the API', async ({
  page,
  request,
}) => {
  const name = `Lab ${Date.now()}`;
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'See how far your stack has drifted from upstream.' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '+ New board' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
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
