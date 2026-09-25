// RSS 2.0 feeds (docs/06 routes): per product, per board and weekly. Links point at our version pages, which link on
// to the vendor's notes. Board feeds carry product ids only — never versions (principle 1: the inventory is private).
import type { FeedIndex, FeedProduct, ItemType, WeekDigest } from '@versiondrift/schema';
import type { Translate } from '$lib/i18n';

export interface RssItem {
  title: string;
  link: string;
  pubDate: Date;
  /** HTML; escaped when written. */
  description: string;
  categories: string[];
}

export interface RssChannel {
  title: string;
  link: string;
  description: string;
  self: string;
  language: string;
}

const IMPORTANT: ItemType[] = ['security', 'breaking', 'deprecated'];
const ITEMS_IN_DESCRIPTION = 15;

const escapeXml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const versionLink = (origin: string, id: string, version: string) =>
  `${origin}/p/${id}/v/${encodeURIComponent(version)}`;

/** Types present, important ones first: ["security", "fix"]. */
function typesOf(types: Iterable<ItemType>): ItemType[] {
  const set = new Set(types);
  return [...IMPORTANT, 'feature', 'fix'].filter((t): t is ItemType => set.has(t as ItemType));
}

export function productItems(product: FeedProduct, origin: string, limit = 30): RssItem[] {
  return product.releases
    .filter((r) => !r.prerelease)
    .slice(0, limit)
    .map((r) => {
      const types = typesOf(r.items.map((i) => i.type));
      const shown = [...r.items]
        .sort((a, b) => Number(IMPORTANT.includes(b.type)) - Number(IMPORTANT.includes(a.type)))
        .slice(0, ITEMS_IN_DESCRIPTION);
      const list = shown.map((i) => `<li><b>${i.type}</b> ${escapeXml(i.text)}</li>`).join('');
      const more = r.items.length - shown.length;
      return {
        title: `${product.name} ${r.version}${types.length ? ` (${types.join(', ')})` : ''}`,
        link: versionLink(origin, product.id, r.version),
        pubDate: new Date(r.date ?? r.firstSeenAt),
        description:
          (list ? `<ul>${list}</ul>` : '') +
          (more > 0 ? `<p>+${more}</p>` : '') +
          (r.url ? `<p><a href="${escapeXml(r.url)}">${escapeXml(r.url)}</a></p>` : ''),
        categories: types,
      };
    });
}

/** One item per release of the given products (all products when `only` is absent), newest first. */
export function releaseItems(
  digests: WeekDigest[],
  index: FeedIndex,
  origin: string,
  only?: ReadonlySet<string>,
  limit = 100,
): RssItem[] {
  return digests
    .flatMap((d) => d.entries)
    .filter((e) => (!only || only.has(e.product)) && index.products[e.product])
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map((e) => {
      const name = index.products[e.product]?.name ?? e.product;
      const types = typesOf(e.types);
      return {
        title: `${name} ${e.version}${types.length ? ` (${types.join(', ')})` : ''}`,
        link: versionLink(origin, e.product, e.version),
        pubDate: new Date(e.date),
        description: e.maxSeverity ? `<p>Highest advisory severity: ${e.maxSeverity}</p>` : '',
        categories: types,
      };
    });
}

/** One item per ISO week: what shipped across the catalog. */
export function weekItems(digests: WeekDigest[], index: FeedIndex, origin: string, t: Translate): RssItem[] {
  return digests
    .filter((d) => d.entries.length > 0)
    .map((d) => {
      const security = d.entries.filter((e) => e.types.includes('security')).length;
      const list = [...d.entries]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((e) => {
          const name = escapeXml(index.products[e.product]?.name ?? e.product);
          const types = typesOf(e.types);
          return `<li><a href="${versionLink(origin, e.product, e.version)}">${name} ${escapeXml(e.version)}</a>${types.length ? ` — ${types.join(', ')}` : ''}</li>`;
        })
        .join('');
      return {
        title: t('rssWeekItem', {
          week: d.week,
          releases: t('countReleases', { n: d.entries.length }),
          security: t('countSecurity', { n: security }),
        }),
        link: `${origin}/week?w=${d.week}`,
        // The digest is complete once its week is over; date it at the end of the week.
        pubDate: new Date(`${d.to}T23:59:59Z`),
        description: `<ul>${list}</ul>`,
        categories: [],
      };
    });
}

export function rssXml(channel: RssChannel, items: RssItem[]): string {
  const body = items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.link)}</guid>
      <pubDate>${item.pubDate.toUTCString()}</pubDate>
${item.categories.map((c) => `      <category>${escapeXml(c)}</category>\n`).join('')}      <description>${escapeXml(item.description)}</description>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <language>${channel.language}</language>
    <atom:link href="${escapeXml(channel.self)}" rel="self" type="application/rss+xml" />
${body}
  </channel>
</rss>
`;
}

export const RSS_HEADERS = {
  'content-type': 'application/rss+xml; charset=utf-8',
  'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
};

/** "grafana,nginx" → ids that look like module ids (at most 200). */
export function parseIds(text: string): string[] {
  return [
    ...new Set(
      decodeURIComponent(text)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s)),
    ),
  ].slice(0, 200);
}
