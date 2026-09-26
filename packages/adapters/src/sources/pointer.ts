// "Newest version" files of update servers, and per-version notes files (MikroTik: upgrade.mikrotik.com/routeros/
// NEWESTa7.stable → "7.24.4 1789558341"; …/7.24.4/CHANGELOG → the notes).
import type { ReleaseSource } from '@versiondrift/schema';
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
): Promise<{ notes: NonNullable<RawRelease['notes']>; date?: string } | undefined> {
  let body: string;
  try {
    body = (await ctx.fetcher.text(source.url.replaceAll('{version}', encodeURIComponent(version)))).body;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return undefined;
    throw error;
  }
  if (!body.trim()) return undefined;
  const firstLine = body.trimStart().split('\n', 1)[0] ?? '';
  const date = parseDate(firstLine) ?? parseDate(firstLine, 'YYYY-MMM-DD');
  return { notes: { format: source.format ?? 'text', body }, ...(date && { date }) };
}
