// Lifecycle (branches, EOL dates) from endoflife.date API v1, or from a hand-maintained YAML file.
import type { EolSource } from '@versiondrift/schema';
import { parse as parseYaml } from 'yaml';
import { SourceError, type AdapterContext, type RawBranch } from '../types.ts';
import type { SourceType } from './common.ts';

interface EolRelease {
  name: string;
  codename: string | null;
  releaseDate: string | null;
  isLts: boolean;
  isEol: boolean;
  eolFrom: string | null;
  latest: { name: string; date: string | null } | null;
}

export async function endoflifeBranches(
  source: SourceType<EolSource, 'endoflife'>,
  ctx: AdapterContext,
): Promise<RawBranch[]> {
  const data = await ctx.fetcher.json<{ result?: { releases?: EolRelease[] } }>(
    `https://endoflife.date/api/v1/products/${encodeURIComponent(source.product)}`,
  );
  const releases = data.result?.releases;
  if (!releases) throw new SourceError(`endoflife.date returned no releases for "${source.product}"`);
  return releases.map((r) => ({
    name: r.name,
    ...(r.codename && { codename: r.codename }),
    ...(r.releaseDate && { releaseDate: r.releaseDate }),
    eol: r.isEol,
    ...(r.eolFrom && { eolDate: r.eolFrom }),
    lts: r.isLts,
    ...(r.latest && { latest: r.latest.name }),
    ...(r.latest?.date && { latestDate: r.latest.date }),
  }));
}

/** `file` holds a YAML list of { name, releaseDate?, eolDate?, eol?, lts?, codename? }. */
export async function manualBranches(
  source: SourceType<EolSource, 'manual'>,
  ctx: AdapterContext,
): Promise<RawBranch[]> {
  if (!ctx.readRepoFile) throw new SourceError('manual sources need readRepoFile');
  const list: unknown = parseYaml(await ctx.readRepoFile(source.file));
  if (!Array.isArray(list)) throw new SourceError(`${source.file} must be a YAML list`);
  const today = new Date().toISOString().slice(0, 10);
  return list.map((entry: Record<string, unknown>, i) => {
    const name = entry.name;
    if (typeof name !== 'string' && typeof name !== 'number')
      throw new SourceError(`${source.file}[${i}]: name is required`);
    const eolDate = typeof entry.eolDate === 'string' ? entry.eolDate : undefined;
    return {
      name: String(name),
      ...(typeof entry.codename === 'string' && { codename: entry.codename }),
      ...(typeof entry.releaseDate === 'string' && { releaseDate: entry.releaseDate }),
      eol: typeof entry.eol === 'boolean' ? entry.eol : eolDate !== undefined && eolDate <= today,
      ...(eolDate && { eolDate }),
      lts: entry.lts === true,
    };
  });
}
