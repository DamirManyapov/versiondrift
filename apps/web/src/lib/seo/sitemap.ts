// sitemap.xml (docs/06 "SEO"): product pages, version pages for recent releases and branch heads, and their
// comparisons with the latest release — only where the release notes give the comparison something to show.
import type { FeedIndex, Versions } from '@versiondrift/schema';

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
}

const segment = (version: string) => encodeURIComponent(version);

export function sitemapUrls(index: FeedIndex, versions: Versions | undefined, origin: string): SitemapUrl[] {
  const urls: SitemapUrl[] = [{ loc: `${origin}/` }, { loc: `${origin}/catalog` }];
  for (const [id, entry] of Object.entries(index.products)) {
    const lastmod = entry.updatedAt.slice(0, 10);
    urls.push({ loc: `${origin}/p/${id}`, lastmod });
    const known = versions?.products[id];
    if (!known) continue;
    for (const version of new Set([...known.recent, ...known.branches])) {
      urls.push({ loc: `${origin}/p/${id}/v/${segment(version)}`, lastmod });
      if (known.notes && entry.latest && version !== entry.latest)
        urls.push({ loc: `${origin}/p/${id}/${segment(version)}...${segment(entry.latest)}`, lastmod });
    }
  }
  return urls;
}

const escapeXml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function sitemapXml(urls: SitemapUrl[]): string {
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
