// Builds the small, fixed feed the e2e tests run on, from the live public feed:
//   node apps/web/e2e/make-feed.ts
// A few products, trimmed (30 releases, 20 advisories), with index hashes recomputed, so tests don't change when
// upstream ships. Unsigned: the e2e server serves it as a local copy and never syncs.
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FeedIndex, FeedProduct } from '@versiondrift/schema';

const SOURCE = 'https://feed.versiondrift.dev/v1/';
const PRODUCTS = [
  'grafana',
  'nginx',
  'debian',
  'routeros',
  'postgresql',
  'poste-io',
  'zabbix',
  'proxmox-ve',
  'elasticsearch',
  'kubernetes',
];
const OUT = path.join(import.meta.dirname, 'feed/v1');

const get = async (file: string) => {
  const response = await fetch(SOURCE + file);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
};

const index = JSON.parse(await get('index.json')) as FeedIndex;
await rm(path.join(import.meta.dirname, 'feed'), { recursive: true, force: true });
await mkdir(path.join(OUT, 'products'), { recursive: true });
const products: FeedIndex['products'] = {};
for (const id of PRODUCTS) {
  const entry = index.products[id]!;
  const product = JSON.parse(await get(entry.url)) as FeedProduct;
  const trimmed = {
    ...product,
    releases: product.releases.slice(0, 30),
    advisories: product.advisories.slice(0, 20),
  };
  const text = JSON.stringify(trimmed);
  const sha256 = createHash('sha256').update(text).digest('hex');
  await writeFile(path.join(OUT, 'products', `${id}.json`), text);
  products[id] = { ...entry, sha256, url: `products/${id}.json?v=${sha256.slice(0, 12)}` };
}
await writeFile(path.join(OUT, 'index.json'), JSON.stringify({ ...index, products }));
const catalog = JSON.parse(await get('catalog.json')) as { products: { id: string }[] };
await writeFile(
  path.join(OUT, 'catalog.json'),
  JSON.stringify({ ...catalog, products: catalog.products.filter((p) => PRODUCTS.includes(p.id)) }),
);
await writeFile(path.join(OUT, 'health.json'), await get('health.json'));
console.log(`wrote ${PRODUCTS.length} products to ${OUT}`);
