import { loadProduct, PAGE_CACHE } from '$lib/feed/load';
import type { PageServerLoad } from './$types';

const RECENT = 15;
const ADVISORIES = 20;

// Server-rendered for search engines. A server load, so only what the page shows is serialized into the HTML
// (a universal load would inline the whole product file, over 1 MB for some products).
export const load: PageServerLoad = async ({ params, fetch, setHeaders }) => {
  const { entry, product, generatedAt } = await loadProduct(fetch, params.id);
  setHeaders(PAGE_CACHE);
  const stable = product.releases.filter((r) => !r.prerelease);
  const shown = new Set(stable.slice(0, RECENT));
  for (const track of product.tracks) {
    const latest = stable.find((r) => r.track === track.id);
    if (latest) shown.add(latest);
  }
  return {
    entry,
    generatedAt,
    product: {
      ...product,
      releases: stable.filter((r) => shown.has(r)),
      advisories: product.advisories.slice(0, ADVISORIES),
    },
  };
};
