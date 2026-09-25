// A collector run (docs/04 "Run lifecycle"): load modules and the previous feed, collect every module, build
// the feed files, check them against the previous feed and write them.
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createFetcher,
  FileHttpCache,
  recordingFetch,
  type Fetcher,
  type Logger,
} from '@versiondrift/adapters';
import {
  validateModules,
  type FeedProduct,
  type HealthEntry,
  type IndexEntry,
  type Module,
} from '@versiondrift/schema';
import { buildCatalog, buildHealth, buildIndex, buildWeeks, indexEntry, serializeProduct } from './build.ts';
import { guardProblems } from './guard.ts';
import { EMPTY_FEED, loadPreviousFeed, type PreviousFeed } from './previous.ts';
import { collectProduct, isoSeconds, type ProductResult } from './product.ts';

export const COLLECTOR_VERSION = '0.1.0';

export interface RunOptions {
  productsDir: string;
  only?: string[];
  /** Directory to write the feed into (files go to <out>/v1/…). */
  out: string;
  /** URL or directory of the previous feed; null to start from scratch. */
  previous: string | null;
  cacheDir?: string;
  recordFixtures?: string;
  dryRun?: boolean;
  force?: boolean;
  githubToken?: string;
  concurrency?: number;
  now?: Date;
  log: Logger;
  /** Tests inject a fetcher (fixtures). */
  fetcher?: Fetcher;
}

export interface ModuleOutcome {
  id: string;
  result: ProductResult;
}

export interface RunResult {
  exitCode: number;
  files: Map<string, string>;
  outcomes: ModuleOutcome[];
  problems: string[];
  report: string;
}

async function loadModules(productsDir: string, log: Logger): Promise<Module[]> {
  const names = (await readdir(productsDir))
    .filter((n) => n.endsWith('.yaml') && !n.endsWith('.releases.yaml') && !n.startsWith('_'))
    .sort();
  const files = await Promise.all(
    names.map(async (n) => ({
      file: `products/${n}`,
      text: await readFile(path.join(productsDir, n), 'utf8'),
    })),
  );
  const modules: Module[] = [];
  for (const result of validateModules(files)) {
    const errors = result.issues.filter((i) => i.level === 'error');
    if (result.module && errors.length === 0) modules.push(result.module);
    else
      log.warn(
        `${result.file}: invalid, skipped (${errors[0]?.message ?? 'unknown error'}; run pnpm modules:validate)`,
      );
  }
  return modules;
}

async function pool<T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

function report(outcomes: ModuleOutcome[], problems: string[], dryRun: boolean): string {
  const lines = [
    '## Collector run',
    '',
    '| Product | Status | Releases | New | Latest | Notes |',
    '|---|---|---|---|---|---|',
  ];
  for (const { id, result } of outcomes) {
    const product = result.product;
    const releases = product?.releases.length ?? 0;
    const latest = product?.releases.find((r) => !r.prerelease)?.version ?? '–';
    const status = result.ok ? '✅ ok' : product ? '⚠️ failed, kept previous (stale)' : '❌ failed';
    const notes = [...(result.ok ? [] : [result.error]), ...result.warnings]
      .join('<br>')
      .replaceAll('|', '\\|');
    lines.push(
      `| ${id} | ${status} | ${releases} | ${result.ok ? result.newReleases.length : 0} | ${latest} | ${notes} |`,
    );
  }
  if (problems.length) lines.push('', '**Not published:**', ...problems.map((p) => `- ${p}`));
  if (dryRun) lines.push('', '_Dry run: nothing written._');
  return lines.join('\n') + '\n';
}

export async function runCollector(options: RunOptions): Promise<RunResult> {
  const { log } = options;
  const now = options.now ?? new Date();
  const nowIso = isoSeconds(now);
  const all = await loadModules(options.productsDir, log);
  const unknown = (options.only ?? []).filter((id) => !all.some((m) => m.id === id));
  if (unknown.length) throw new Error(`unknown module id(s): ${unknown.join(', ')}`);
  const selected = options.only?.length ? all.filter((m) => options.only!.includes(m.id)) : all;
  const fullRun = selected.length === all.length;

  const previous: PreviousFeed =
    options.previous === null ? EMPTY_FEED : await loadPreviousFeed(options.previous, log);
  const cache = options.cacheDir ? new FileHttpCache(options.cacheDir) : undefined;
  const repoRoot = path.dirname(options.productsDir);
  const fetcherFor = (id: string): Fetcher =>
    options.fetcher ??
    createFetcher({
      ...(cache && { cache }),
      ...(options.githubToken && {
        auth: { 'api.github.com': { authorization: `Bearer ${options.githubToken}` } },
      }),
      ...(options.recordFixtures && {
        fetch: recordingFetch((url, init) => fetch(url, init), path.join(options.recordFixtures, id)),
      }),
    });

  const previousProducts = new Map<string, FeedProduct | undefined>();
  const outcomes = await pool(selected, options.concurrency ?? 8, async (module): Promise<ModuleOutcome> => {
    const before = await previous.product(module.id);
    previousProducts.set(module.id, before);
    const result = await collectProduct(module, before, {
      fetcher: fetcherFor(module.id),
      log,
      now,
      readRepoFile: (p) => readFile(path.join(repoRoot, p), 'utf8'),
    });
    const product = result.product;
    log.info(
      result.ok
        ? `✓ ${module.id}: ${result.product.releases.length} releases (${result.newReleases.length} new), latest ${result.product.releases.find((r) => !r.prerelease)?.version ?? '–'}`
        : `✗ ${module.id}: ${result.error}${product ? ' (kept previous data, marked stale)' : ''}`,
    );
    for (const warning of result.warnings) log.warn(`  ${module.id}: ${warning}`);
    return { id: module.id, result };
  });

  const files = new Map<string, string>();
  const entries: Record<string, IndexEntry> = {};
  const health: Record<string, HealthEntry> = {};
  const byId = new Map(all.map((m) => [m.id, m]));
  // Products not collected in this run keep their previous index entry and health.
  for (const [id, entry] of Object.entries(previous.index?.products ?? {}))
    if (byId.has(id)) entries[id] = entry;
  for (const [id, h] of Object.entries(previous.health?.modules ?? {})) if (byId.has(id)) health[id] = h;

  const products: FeedProduct[] = [];
  const releaseCounts: Record<string, { before: number; after: number }> = {};
  for (const { id, result } of outcomes) {
    const module = byId.get(id)!;
    const before = previousProducts.get(id);
    const prevHealth = previous.health?.modules[id];
    health[id] = {
      status: result.ok ? 'ok' : 'failed',
      lastAttemptAt: nowIso,
      lastSuccessAt: result.ok ? nowIso : (prevHealth?.lastSuccessAt ?? null),
      consecutiveFailures: result.ok ? 0 : (prevHealth?.consecutiveFailures ?? 0) + 1,
      releases: result.product?.releases.length ?? 0,
      ...(!result.ok && { error: result.error }),
      warnings: result.warnings,
    };
    const product = result.product;
    if (!product) {
      delete entries[id];
      continue;
    }
    const bytes = serializeProduct(product);
    files.set(`v1/products/${id}.json`, bytes);
    entries[id] = indexEntry(module, product, bytes);
    products.push(product);
    if (before) releaseCounts[id] = { before: before.releases.length, after: product.releases.length };
  }

  const index = buildIndex(entries, nowIso, COLLECTOR_VERSION);
  files.set('v1/index.json', JSON.stringify(index));
  files.set(
    'v1/catalog.json',
    JSON.stringify(
      buildCatalog(
        all.filter((m) => m.id in entries),
        nowIso,
      ),
    ),
  );
  files.set('v1/health.json', JSON.stringify(buildHealth(health, nowIso)));
  if (fullRun)
    for (const [week, digest] of buildWeeks(products, now))
      files.set(`v1/week/${week}.json`, JSON.stringify(digest));

  const problems = guardProblems({ previous: previous.index, next: index, releaseCounts });
  const text = report(outcomes, problems, options.dryRun ?? false);
  const allFailed = outcomes.length > 0 && outcomes.every((o) => !o.result.ok);
  const blocked = problems.length > 0 && !options.force;

  if (!options.dryRun && !blocked) {
    await rm(path.join(options.out, 'v1'), { recursive: true, force: true });
    for (const [file, content] of files) {
      const target = path.join(options.out, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
  if (cache && fullRun && !options.dryRun) {
    const used = cache.usedFiles();
    for (const file of await readdir(cache.dir).catch(() => [] as string[])) {
      if (!used.has(file)) await rm(path.join(cache.dir, file), { force: true });
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
  for (const problem of problems)
    log.warn(`guard: ${problem}${options.force ? ' (--force: writing anyway)' : ''}`);

  return { exitCode: blocked ? 2 : allFailed ? 1 : 0, files, outcomes, problems, report: text };
}
