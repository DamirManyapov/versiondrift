// Changelog pages without a feed. `select.item` matches one element per release; `title`, `body` and `date`
// are looked up inside it (or are the item itself). A heading item without `body` owns the following siblings
// up to the next item — the usual "<h2>1.2.3</h2><ul>…</ul>" layout; so does an element that only wraps a heading
// (docs generators emit "<div class="heading-wrapper"><h2>…</h2></div>").
import type { ReleaseSource } from '@versiondrift/schema';
import * as cheerio from 'cheerio';
import { SourceError, type AdapterContext, type RawRelease } from '../types.ts';
import { extractVersion, parseDate, toIso, type SourceType } from './common.ts';

type HtmlSource = SourceType<ReleaseSource, 'html'>;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const HEADINGS = 'h1, h2, h3, h4, h5, h6';

export function parseHtmlReleases(html: string, source: HtmlSource): RawRelease[] {
  const $ = cheerio.load(html);
  const items = $(source.select.item);
  if (items.length === 0) {
    throw new SourceError(
      `selector "${source.select.item}" matched nothing on ${source.url}: the page layout may have changed`,
    );
  }
  const out: RawRelease[] = [];
  items.each((_, node) => {
    const item = $(node);
    const pick = (selector: string | undefined) => {
      if (selector === undefined) return undefined;
      if (item.is(selector)) return item;
      const found = item.find(selector).first();
      return found.length > 0 ? found : undefined;
    };
    const titleEl = pick(source.select.title) ?? item;
    const title = clean(titleEl.text());
    const version = extractVersion(title, source.versionRegex);
    if (!version) return;

    let body: string;
    if (source.select.body !== undefined) {
      body = item
        .find(source.select.body)
        .toArray()
        .map((el) => $.html(el))
        .join('\n');
    } else if (item.is(HEADINGS) || (item.children().length === 1 && item.children().first().is(HEADINGS))) {
      body = item
        .nextUntil(source.select.item)
        .toArray()
        .map((el) => $.html(el))
        .join('\n');
    } else {
      body = item.html() ?? '';
    }

    // Without a date selector: the title first, then the start of the body ("Released 05. August 2026").
    const dateEl = pick(source.select.date);
    const date = dateEl
      ? (parseDate(dateEl.text(), source.dateFormat) ??
        toIso(dateEl.attr('datetime') ?? clean(dateEl.text())))
      : (parseDate(title, source.dateFormat) ??
        parseDate(clean(cheerio.load(body).text()).slice(0, 300), source.dateFormat));

    const href = titleEl.is('a') ? titleEl.attr('href') : titleEl.find('a[href]').first().attr('href');
    const id = item.attr('id') ?? titleEl.attr('id') ?? item.find('[id]').first().attr('id');
    const url = href ? new URL(href, source.url).toString() : id ? `${source.url}#${id}` : source.url;

    out.push({
      version,
      title,
      url,
      ...(date && { date }),
      ...(body.trim() && { notes: { format: 'html', body } }),
    });
  });
  return out;
}

export async function htmlReleases(source: HtmlSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const { body } = await ctx.fetcher.text(source.url, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  return parseHtmlReleases(body, source);
}
