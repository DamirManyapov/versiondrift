// "Newest version" files of update servers, and per-version notes files (MikroTik: upgrade.mikrotik.com/routeros/
// NEWESTa7.stable → "7.24.4 1789558341"; …/7.24.4/CHANGELOG → the notes).
import type { ReleaseSource } from '@versiondrift/schema';
import * as cheerio from 'cheerio';
import { HttpError } from '../http/fetcher.ts';
import { SourceError, type AdapterContext, type RawRelease } from '../types.ts';
import { extractVersion, parseDate, type SourceType } from './common.ts';

type PointerSource = SourceType<ReleaseSource, 'pointer'>;
type NotesSource = SourceType<ReleaseSource, 'notes'>;

/** The version a pointer URL names, or throws. Also used for pointer tracks. */
export async function readPointer(
  url: string,
  versionRegex: string | undefined,
  ctx: Pick<AdapterContext, 'fetcher'>,
): Promise<{ version: string; text: string }> {
  const text = (await ctx.fetcher.text(url)).body.trim();
  const version = extractVersion(text, versionRegex);
  if (!version) throw new SourceError(`no version in ${url}: "${text.slice(0, 80)}"`);
  return { version, text };
}

export async function pointerReleases(source: PointerSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const { version, text } = await readPointer(source.url, source.versionRegex, ctx);
  const seconds = source.epoch
    ? /\b(\d{9,11})\b/.exec(text.slice(text.indexOf(version) + version.length))?.[1]
    : undefined;
  const date = seconds ? new Date(Number(seconds) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') : undefined;
  return [{ version, ...(date && { date }) }];
}

/**
 * Notes for one version from the source's URL template; undefined when the server has none (404). The first line's
 * date ("What's new in 7.24 (2026-Aug-14 11:33):") comes along when it is there.
 */
export async function fetchNotes(
  source: NotesSource,
  version: string,
  ctx: Pick<AdapterContext, 'fetcher'>,
  releaseUrl?: string,
): Promise<{ notes: NonNullable<RawRelease['notes']>; date?: string } | undefined> {
  if (source.url === '{url}' && !releaseUrl) return undefined;
  const url =
    source.url === '{url}' ? releaseUrl! : source.url.replaceAll('{version}', encodeURIComponent(version));
  let body: string;
  try {
    body = (await ctx.fetcher.text(url)).body;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return undefined;
    throw error;
  }
  if (!body.trim()) return undefined;
  if (source.dialect === 'debian-announcement') {
    const markdown = debianAnnouncement(body);
    return markdown ? { notes: { format: 'markdown', body: markdown } } : undefined;
  }
  const firstLine = body.trimStart().split('\n', 1)[0] ?? '';
  const date = parseDate(firstLine) ?? parseDate(firstLine, 'YYYY-MMM-DD');
  return { notes: { format: source.format ?? 'text', body }, ...(date && { date }) };
}

/**
 * A Debian point release announcement as notes: the "Miscellaneous Bugfixes" table (package → reason) and the
 * "Security Updates" table (advisory → package), security first so it survives the 40-item cap.
 */
export function debianAnnouncement(html: string): string {
  const $ = cheerio.load(html);
  const section = (heading: RegExp) => {
    const h2 = $('h2')
      .filter((_, el) => heading.test($(el).text()))
      .first();
    return h2
      .nextUntil('h2')
      .find('tr')
      .toArray()
      .map((tr) =>
        $(tr)
          .find('td')
          .toArray()
          .map((td) => $(td).text().replace(/\s+/g, ' ').trim()),
      );
  };
  const fixes = section(/Miscellaneous Bugfixes/i).filter(
    (cells) => cells.length >= 2 && cells[0] && cells[1],
  );
  const byAdvisory = new Map<string, string[]>();
  for (const [advisory, pkg] of section(/Security Updates/i)) {
    if (!advisory || !pkg) continue;
    byAdvisory.set(advisory, [...(byAdvisory.get(advisory) ?? []), pkg]);
  }
  const parts: string[] = [];
  if (byAdvisory.size > 0) {
    // One item for all advisories: dozens of "DSA-1234: package" lines would crowd out the bug fixes.
    const list = [...byAdvisory].map(
      ([id, pkgs]) => `${id} ${pkgs[0]}${pkgs.length > 1 ? ` +${pkgs.length - 1}` : ''}`,
    );
    const text = `${byAdvisory.size} security advisories included: ${list.join(', ')}`;
    parts.push(
      '### Security updates',
      `- ${text.length > 290 ? `${text.slice(0, 288).replace(/,[^,]*$/, '')}, …` : text}`,
    );
  }
  if (fixes.length > 0)
    parts.push('', '### Bug fixes', ...fixes.map(([pkg, reason]) => `- ${pkg}: ${reason}`));
  return parts.join('\n').trim();
}
