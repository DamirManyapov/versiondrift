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
  const url = source.url === '{url}' ? releaseUrl! : notesUrl(source.url, version);
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
  if (source.dialect === 'microsoft-kb') {
    const markdown = microsoftKb(body);
    return markdown ? { notes: { format: 'markdown', body: markdown } } : undefined;
  }
  if (source.select !== undefined) {
    const $ = cheerio.load(body);
    const parts = $(source.select);
    if (parts.length === 0) return undefined;
    // Self-links that docs generators put next to headings and items: "§" (PostgreSQL), "¶" (Sphinx), "#".
    parts
      .find('a')
      .filter((_, a) => /^[§¶#]$/.test($(a).text().trim()))
      .remove();
    const opening = parts.first().text().replace(/\s+/g, ' ').slice(0, 500);
    const date = parseDate(opening);
    const html = parts
      .toArray()
      .map((el) => $.html(el))
      .join('\n');
    return { notes: { format: 'html', body: html }, ...(date && { date }) };
  }
  const firstLine = body.trimStart().split('\n', 1)[0] ?? '';
  const date = parseDate(firstLine) ?? parseDate(firstLine, 'YYYY-MMM-DD');
  return { notes: { format: source.format ?? 'text', body }, ...(date && { date }) };
}

/**
 * A notes URL template filled in: {version}, and its first four numbers {major}, {minor}, {patch}, {build}
 * ("8.4.6-6.1" → 8, 4, 6, 6).
 */
export function notesUrl(template: string, version: string): string {
  const [major = '0', minor = '0', patch = '0', build = '0'] = version.match(/\d+/g) ?? [];
  return template
    .replaceAll('{version}', encodeURIComponent(version))
    .replaceAll('{major}', major)
    .replaceAll('{minor}', minor)
    .replaceAll('{patch}', patch)
    .replaceAll('{build}', build);
}

/**
 * A Windows update's KB article as notes: the bullets under "Improvements" or "Summary" (the heading differs by
 * product and age) without the known issues, the "applies to" product lists and the links to earlier KBs; the
 * link to that month's security updates becomes a first, security line.
 */
export function microsoftKb(html: string): string {
  const $ = cheerio.load(html);
  const heading = $('h2')
    .filter((_, el) => /^(improvements( and fixes)?|summary|highlights)$/i.test($(el).text().trim()))
    .first();
  if (heading.length === 0) return '';
  const $s = cheerio.load(
    heading
      .nextUntil('h2')
      .toArray()
      .map((el) => $.html(el))
      .join('\n'),
  );
  $s('h3, h4')
    .filter((_, el) => /known issues/i.test($s(el).text()))
    .each((_, el) => {
      $s(el).nextUntil('h2, h3').remove();
      $s(el).remove();
    });
  const bullets = new Set<string>();
  $s('li').each((_, el) => {
    const own = $s(el).clone();
    own.find('ul, ol').remove();
    const text = own.text().replace(/\s+/g, ' ').trim();
    const earlierKb = /^\w+ \d{1,2}, \d{4}\s*[—–-]\s*KB\d+/.test(text);
    const label = text.split(' ').length < 5 && !text.includes('.'); // "Windows Server 2019", "[Sysmon]"
    if (text && !earlierKb && !label) bullets.add(text);
  });
  const month = $('a')
    .filter((_, el) => /^\w+ \d{4} Security Updates$/i.test($(el).text().trim()))
    .first()
    .text()
    .trim();
  const lines = [...(month ? [`Security update: includes the ${month}`] : []), ...bullets];
  return lines.map((line) => `- ${line}`).join('\n');
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
