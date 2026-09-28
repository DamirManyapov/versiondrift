import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const server = spawn('node', ['e2e/serve.ts', 'selfhosted', '4190'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const page = await browser.newPage();
const base = 'http://localhost:4190';
try {
  await page.goto(base + '/');
  await page.getByRole('button', { name: '+ New board' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill('Lab X');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('heading', { name: 'Your board is empty' }).waitFor();
  console.log(
    'after create: select',
    await page.locator('#board-pick').inputValue(),
    'ls',
    await page.evaluate(() => localStorage.getItem('vd.board')),
  );
  await page.goto(base + '/p/debian');
  await page.getByRole('button', { name: 'Add to my board' }).click();
  await page.goto(base + '/');
  await page.locator('[data-tile]').first().waitFor();
  await page.waitForTimeout(1500);
  console.log(
    'after revisit: select value',
    await page.locator('#board-pick').inputValue(),
    'checked',
    await page.locator('#board-pick option:checked').textContent(),
    'ls',
    await page.evaluate(() => localStorage.getItem('vd.board')),
  );
  console.log('options', await page.locator('#board-pick option').allTextContents());
  console.log('html', (await page.locator('#board-pick').innerHTML()).slice(0, 300));
} finally {
  await browser.close();
  server.kill();
}
