// Lifecycle (branches, EOL dates) from endoflife.date API v1, or from a hand-maintained YAML file.
import type { EolSource } from '@versiondrift/schema';
import { parse as parseYaml } from 'yaml';
import { SourceError, type AdapterContext, type RawBranch, type RawRelease } from '../types.ts';
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
  // `cycles` renames cycles to the version prefix they cover ("2022" → "20348"), keeping the name as codename.
  const { cycles } = source;
  const kept = cycles ? releases.filter((r) => cycles[r.name] !== undefined) : releases;
  return kept.map((r) => {
    const codename = r.codename ?? (cycles ? r.name : null);
    return {
      name: cycles?.[r.name] ?? r.name,
      ...(codename && { codename }),
      ...(r.releaseDate && { releaseDate: r.releaseDate }),
      eol: r.isEol,
      ...(r.eolFrom && { eolDate: r.eolFrom }),
      lts: r.isLts,
      ...(r.latest && { latest: r.latest.name }),
      ...(r.latest?.date && { latestDate: r.latest.date }),
    };
  });
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

/**
 * Releases from endoflife.date for products without public release notes (OS, appliances): the latest release of
 * every cycle. History grows with every run as new point releases replace the previous ones.
 */
export async function endoflifeReleases(
  source: { type: 'endoflife'; product: string },
  ctx: AdapterContext,
): Promise<RawRelease[]> {
  const data = await ctx.fetcher.json<{
    result?: { releases?: (EolRelease & { latest: { link?: string | null } | null })[] };
  }>(`https://endoflife.date/api/v1/products/${encodeURIComponent(source.product)}`);
  const releases = data.result?.releases;
  if (!releases) throw new SourceError(`endoflife.date returned no releases for "${source.product}"`);
  return releases.flatMap((r) => {
    if (!r.latest) return [];
    const date = r.latest.date ? `${r.latest.date}T00:00:00Z` : undefined;
    return [
      {
        version: r.latest.name,
        ...(date && { date }),
        url: r.latest.link ?? `https://endoflife.date/${source.product}`,
      },
    ];
  });
}
