import type { Catalog } from '@versiondrift/schema';

export type CatalogEntry = Catalog['products'][number];

/** Loose match: every word of the query must appear in the name, id, vendor, aliases or description. */
export function searchCatalog(products: CatalogEntry[], query: string, category?: string): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return products.filter((p) => {
    if (category !== undefined && p.category !== category) return false;
    const haystack = [p.name, p.id, p.vendor ?? '', ...(p.aliases ?? []), p.description ?? '']
      .join(' ')
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
