import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { loadProduct, PAGE_CACHE } from '$lib/feed/load';
import { compareView } from '$lib/seo/pages';
import type { PageServerLoad } from './$types';

/** Items shown per release; the rest is counted and linked to the vendor's notes. */
const ITEMS_PER_RELEASE = 40;

// Compare page (docs/06): server-rendered, canonical order and spelling, 404 when there is nothing in between.
// A server load: only the comparison is serialized into the HTML, not the whole product file.
export const load: PageServerLoad = async ({ params, fetch, setHeaders }) => {
  const { entry, product, generatedAt } = await loadProduct(fetch, params.id);
  const result = compareView(product, params.range);
  if (result.kind === 'redirect')
    redirect(301, resolve('/p/[id]/[range=range]', { id: params.id, range: result.range }));
  if (result.kind === 'notFound') error(404, `No comparison for ${params.range}: ${result.reason}`);
  setHeaders(PAGE_CACHE);
  const { view } = result;
  const latest = product.releases.find((r) => !r.prerelease);
  return {
    id: params.id,
    entry,
    generatedAt,
    name: product.name,
    latest: latest?.version,
    view: {
      ...view,
      releases: view.releases.map((r) => ({
        ...r,
        items: r.items.slice(0, ITEMS_PER_RELEASE),
        moreItems: (r.moreItems ?? 0) + Math.max(0, r.items.length - ITEMS_PER_RELEASE),
      })),
    },
  };
};
