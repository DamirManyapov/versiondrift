// Releases maintained by hand in products/<id>.releases.yaml: a YAML list of { version, date?, url?, notes? }.
import type { ReleaseSource } from '@versiondrift/schema';
import { parse as parseYaml } from 'yaml';
import { SourceError, type AdapterContext, type RawRelease } from '../types.ts';
import { toIso, type SourceType } from './common.ts';

export async function manualReleases(
  source: SourceType<ReleaseSource, 'manual'>,
  ctx: AdapterContext,
): Promise<RawRelease[]> {
  if (!ctx.readRepoFile) throw new SourceError('manual sources need readRepoFile');
  const list: unknown = parseYaml(await ctx.readRepoFile(source.file));
  if (!Array.isArray(list)) throw new SourceError(`${source.file} must be a YAML list`);
  return list.map((entry: Record<string, unknown>, i) => {
    const version = entry.version;
    if (typeof version !== 'string')
      throw new SourceError(`${source.file}[${i}]: version must be a quoted string`);
    const date = toIso(typeof entry.date === 'string' ? entry.date : undefined);
    return {
      version,
      ...(date && { date }),
      ...(typeof entry.url === 'string' && { url: entry.url }),
      ...(typeof entry.notes === 'string' && { notes: { format: 'markdown' as const, body: entry.notes } }),
    };
  });
}
