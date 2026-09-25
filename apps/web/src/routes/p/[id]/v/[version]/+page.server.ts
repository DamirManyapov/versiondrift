import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { loadProduct, PAGE_CACHE } from '$lib/feed/load';
import { versionView } from '$lib/seo/pages';
import type { PageServerLoad } from './$types';

const NEWER_SHOWN = 15;

// "Is <version> affected?" (docs/06): only for releases the feed knows.
export const load: PageServerLoad = async ({ params, fetch, setHeaders }) => {
  const { entry, product, generatedAt } = await loadProduct(fetch, params.id);
  const result = versionView(product, params.version);
  if (result.kind === 'redirect')
    redirect(301, resolve('/p/[id]/v/[version]', { id: params.id, version: result.version }));
  if (result.kind === 'notFound') error(404, `${product.name} has no release ${params.version}`);
  setHeaders(PAGE_CACHE);
  const { release, status, fixes } = result.view;
  return {
    id: params.id,
    entry,
    generatedAt,
    name: product.name,
    release: { ...release, items: [] },
    status: { ...status, newer: status.newer.slice(0, NEWER_SHOWN).map((r) => ({ ...r, items: [] })) },
    newerTotal: status.newer.length,
    fixes,
  };
};
