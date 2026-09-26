// Changelog files in a vendor's own layout. zabbix (ChangeLog on each release branch):
//
//   Changes for 7.4.15
//
//   7.4.15rc1 was released as 7.4.15 without any changes
//   --------------------------------------------------------------------------------
//   Changes for 7.4.15rc1
//
//   New features:
//   ...G...... [ZBXNEXT-10451] added Zabbix agent 2 pprof profiler (opucka)
//   Bug fixes:
//   ..F....... [ZBX-27793] fixed incorrect screen reader announcements (aluchko)
import type { ReleaseSource } from '@versiondrift/schema';
import { SourceError, type AdapterContext, type RawRelease } from '../types.ts';
import type { SourceType } from './common.ts';

type ChangelogSource = SourceType<ReleaseSource, 'changelog'>;

const BLOCK_SEPARATOR = /^-{20,}\s*$/m;
const HEADING = /^Changes for (\S+)\s*$/m;
const SAME_AS = /^(\S+) was released as \S+ without any changes/;
const FLAGGED = /^[.A-Z]{10} (.*)$/; // the column of component letters before each entry

/** Notes (Markdown) per version from a Zabbix ChangeLog; a final release without changes gets its rc's notes. */
export function parseZabbixChangelog(text: string): RawRelease[] {
  const bodies = new Map<string, string>();
  const sameAs = new Map<string, string>();
  for (const block of text.split(BLOCK_SEPARATOR)) {
    const heading = HEADING.exec(block);
    if (!heading) continue;
    const version = heading[1]!;
    const body = block.slice(heading.index + heading[0].length).trim();
    const alias = SAME_AS.exec(body);
    if (alias) {
      sameAs.set(version, alias[1]!);
      continue;
    }
    const lines = body.split('\n').map((line) => {
      const flagged = FLAGGED.exec(line);
      if (flagged) return `- ${flagged[1]!.trim()}`;
      const section = /^([A-Z][A-Za-z ]+):\s*$/.exec(line);
      return section ? `### ${section[1]!}` : line;
    });
    bodies.set(version, lines.join('\n').trim());
  }
  for (const [version, source] of sameAs) {
    const body = bodies.get(source);
    if (body !== undefined && !bodies.has(version)) bodies.set(version, body);
  }
  return [...bodies].flatMap(([version, body]) =>
    body ? [{ version, notes: { format: 'markdown' as const, body } }] : [],
  );
}

export async function changelogFileReleases(
  source: ChangelogSource,
  ctx: AdapterContext,
): Promise<RawRelease[]> {
  const text = (await ctx.fetcher.text(source.url)).body;
  const releases = parseZabbixChangelog(text);
  if (releases.length === 0) throw new SourceError(`no "Changes for" entries in ${source.url}`);
  return releases;
}
