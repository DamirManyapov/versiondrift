// RSS 2.0, RSS 1.0 (RDF) and Atom. Entries whose title (or link) doesn't yield a version are other news and skipped.
import type { ReleaseSource } from '@versiondrift/schema';
import * as cheerio from 'cheerio';
import { SourceError, type AdapterContext, type RawRelease } from '../types.ts';
import { extractVersion, toIso, type SourceType } from './common.ts';

type RssSource = SourceType<ReleaseSource, 'rss'>;

export interface FeedEntry {
  title?: string;
  link?: string;
  date?: string;
  /** HTML */
  content?: string;
}

export function parseFeed(xml: string): FeedEntry[] {
  const $ = cheerio.load(xml, { xml: true });
  const text = (el: ReturnType<typeof $>, selector: string) => {
    const found = el.find(selector).first();
    return found.length ? found.text().trim() : undefined;
  };
  const entries: FeedEntry[] = [];
  $('item').each((_, node) => {
    const item = $(node);
    entries.push({
      title: text(item, 'title'),
      link: text(item, 'link') ?? item.attr('rdf:about'),
      date: toIso(text(item, 'pubDate') ?? text(item, 'dc\\:date')),
      content: text(item, 'content\\:encoded') ?? text(item, 'description'),
    });
  });
  $('entry').each((_, node) => {
    const entry = $(node);
    const link =
      entry.find('link[rel="alternate"]').first().attr('href') ?? entry.find('link').first().attr('href');
    entries.push({
      title: text(entry, 'title'),
      link,
      date: toIso(text(entry, 'published') ?? text(entry, 'updated')),
      content: text(entry, 'content') ?? text(entry, 'summary'),
    });
  });
  return entries;
}

export async function rssReleases(source: RssSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const { body } = await ctx.fetcher.text(source.url, {
    headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' },
  });
  const entries = parseFeed(body);
  if (entries.length === 0) throw new SourceError(`no RSS/Atom entries at ${source.url}`);
  const out: RawRelease[] = [];
  for (const entry of entries) {
    const from = source.versionFrom === 'link' ? entry.link : entry.title;
    const version = from ? extractVersion(from, source.versionRegex) : undefined;
    if (!version) continue;
    out.push({
      version,
      ...(entry.title && { title: entry.title }),
      ...(entry.link && { url: entry.link }),
      ...(entry.date && { date: entry.date }),
      ...(entry.content && { notes: { format: 'html', body: entry.content } }),
    });
  }
  return out;
}
