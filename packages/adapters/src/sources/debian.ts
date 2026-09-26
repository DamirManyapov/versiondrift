// Debian packaging as a release source (Proxmox VE/Backup Server): the versions an APT repository offers, and the
// package's debian/changelog for notes and dates.
import type { ReleaseSource } from '@versiondrift/schema';
import { SourceError, type AdapterContext, type RawRelease } from '../types.ts';
import { withVersionRegex, type SourceType } from './common.ts';

type AptSource = SourceType<ReleaseSource, 'apt'>;
type ChangelogSource = SourceType<ReleaseSource, 'debian-changelog'>;

/** Versions of `package` in a Packages index (stanzas of "Field: value" lines, blank-line separated). */
export function parsePackages(text: string, pkg: string): string[] {
  const versions: string[] = [];
  for (const stanza of text.split(/\n\s*\n/)) {
    if (!new RegExp(`^Package: ${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(stanza)) continue;
    const version = /^Version: (\S+)$/m.exec(stanza)?.[1];
    if (version) versions.push(version);
  }
  return versions;
}

export async function aptReleases(source: AptSource, ctx: AdapterContext): Promise<RawRelease[]> {
  const text = (await ctx.fetcher.text(source.url)).body;
  const versions = parsePackages(text, source.package);
  if (versions.length === 0) throw new SourceError(`no package "${source.package}" in ${source.url}`);
  return withVersionRegex(
    versions.map((version) => ({ version })),
    source.versionRegex,
  );
}

const HEADER = /^(\S+) \(([^)\s]+)\)[^;\n]*;.*$/;
const TRAILER = /^ -- .*?>\s+(.+)$/;

/** Entries of a debian/changelog: version, notes (Markdown bullets) and the trailer's date. */
export function parseDebianChangelog(text: string): RawRelease[] {
  const out: RawRelease[] = [];
  let current: { version: string; lines: string[] } | undefined;
  for (const line of text.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      current = { version: header[2]!, lines: [] };
      continue;
    }
    if (!current) continue;
    const trailer = TRAILER.exec(line);
    if (trailer) {
      const time = Date.parse(trailer[1]!); // RFC 2822, as dpkg writes it
      const body = current.lines.join('\n').trim();
      out.push({
        version: current.version,
        ...(!Number.isNaN(time) && { date: new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z') }),
        ...(body && { notes: { format: 'markdown' as const, body } }),
      });
      current = undefined;
      continue;
    }
    current.lines.push(line.replace(/^ {2}/, ''));
  }
  return out;
}

export async function debianChangelogReleases(
  source: ChangelogSource,
  ctx: AdapterContext,
): Promise<RawRelease[]> {
  const entries = parseDebianChangelog((await ctx.fetcher.text(source.url)).body);
  if (entries.length === 0) throw new SourceError(`no changelog entries in ${source.url}`);
  return withVersionRegex(entries, source.versionRegex);
}
