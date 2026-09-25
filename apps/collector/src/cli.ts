#!/usr/bin/env node
// pnpm collect … / pnpm collector <command> — see docs/04-collector.md.
import { access, chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createFetcher } from '@versiondrift/adapters';
import { FeedIndex, Health, validateModules } from '@versiondrift/schema';
import { Command } from 'commander';
import { githubIssues, syncModuleIssues } from './issues.ts';
import { moduleReport, upsertComment } from './pr-report.ts';
import { generateSigningKey, parseSecret } from './minisign.ts';
import { publishFeed, pullState, pushState } from './publish.ts';
import { r2Bucket } from './r2.ts';
import { COLLECTOR_VERSION, runCollector } from './run.ts';

const DEFAULT_FEED = process.env.FEED_URL ?? 'https://feed.versiondrift.dev/';
const log = { info: (m: string) => console.log(m), warn: (m: string) => console.warn(m) };

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const bucket = (name: string) =>
  r2Bucket({ accountId: env('CLOUDFLARE_ACCOUNT_ID'), token: env('CLOUDFLARE_API_TOKEN'), bucket: name });

const program = new Command('collector').version(COLLECTOR_VERSION);

program
  .command('collect')
  .description('fetch every module, build the feed and write it to --out')
  .option('--only <ids>', 'comma-separated module ids', (v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .option('--out <dir>', 'output directory (files go to <dir>/v1)', '.feed')
  .option('--products <dir>', 'module directory', 'products')
  .option('--previous <url|dir>', 'previous feed (URL or directory containing v1/)', DEFAULT_FEED)
  .option('--no-previous', 'start from scratch')
  .option('--cache-dir <dir>', 'HTTP cache for conditional requests', '.cache/http')
  .option('--record-fixtures <dir>', 'save every HTTP response as a fixture under <dir>/<module>/')
  .option('--dry-run', 'collect and print the report, write nothing')
  .option('--force', 'write even if the guard finds the feed suspicious')
  .option('--concurrency <n>', 'modules in parallel', (v) => Number(v), 8)
  .action(
    async (opts: {
      only?: string[];
      out: string;
      products: string;
      previous: string | false;
      cacheDir: string;
      recordFixtures?: string;
      dryRun?: boolean;
      force?: boolean;
      concurrency: number;
    }) => {
      const result = await runCollector({
        productsDir: path.resolve(opts.products),
        ...(opts.only && { only: opts.only }),
        out: path.resolve(opts.out),
        previous: opts.previous === false ? null : opts.previous,
        cacheDir: path.resolve(opts.cacheDir),
        ...(opts.recordFixtures && { recordFixtures: path.resolve(opts.recordFixtures) }),
        dryRun: opts.dryRun ?? false,
        force: opts.force ?? false,
        concurrency: opts.concurrency,
        ...(process.env.GITHUB_TOKEN && { githubToken: process.env.GITHUB_TOKEN }),
        ...(process.env.NVD_API_KEY && { nvdApiKey: process.env.NVD_API_KEY }),
        log,
      });
      if (opts.dryRun) console.log(`\n${result.report}`);
      process.exitCode = result.exitCode;
    },
  );

program
  .command('publish')
  .description('sign v1/index.json and upload <dir>/v1 to R2 (needs CLOUDFLARE_*, MINISIGN_SECRET_KEY)')
  .option('--dir <dir>', 'feed directory', '.feed')
  .option('--bucket <name>', 'R2 bucket', 'versiondrift-feed')
  .action(async (opts: { dir: string; bucket: string }) => {
    let published: FeedIndex | undefined;
    try {
      published = FeedIndex.parse(
        await createFetcher().json(new URL('v1/index.json', DEFAULT_FEED).toString()),
      );
    } catch {
      log.info('no published index yet: uploading every file');
    }
    await publishFeed({
      dir: path.resolve(opts.dir),
      bucket: bucket(opts.bucket),
      key: parseSecret(env('MINISIGN_SECRET_KEY')),
      ...(published && { published }),
      log,
    });
  });

program
  .command('state-pull')
  .description('restore the HTTP cache from the private state bucket')
  .option('--cache-dir <dir>', 'HTTP cache directory', '.cache/http')
  .action((opts: { cacheDir: string }) =>
    pullState(path.resolve(opts.cacheDir), bucket('versiondrift-state'), log),
  );

program
  .command('state-push')
  .description('save the HTTP cache to the private state bucket')
  .option('--cache-dir <dir>', 'HTTP cache directory', '.cache/http')
  .action((opts: { cacheDir: string }) =>
    pushState(path.resolve(opts.cacheDir), bucket('versiondrift-state'), log),
  );

program
  .command('keygen')
  .description('create the feed signing key: public key into the repo, secret into a private file')
  .option('--public <file>', 'public key file (committed)', 'keys/feed.pub')
  .option(
    '--secret <file>',
    'secret key file (never commit)',
    path.join(homedir(), '.config/versiondrift/minisign.secret'),
  )
  .action(async (opts: { public: string; secret: string }) => {
    const exists = await access(opts.secret).then(
      () => true,
      () => false,
    );
    if (exists) throw new Error(`${opts.secret} already exists; move it away first`);
    const { secret, publicKey } = generateSigningKey();
    await mkdir(path.dirname(opts.secret), { recursive: true });
    await writeFile(opts.secret, `${secret}\n`, { mode: 0o600 });
    await chmod(opts.secret, 0o600);
    await mkdir(path.dirname(opts.public), { recursive: true });
    await writeFile(opts.public, publicKey);
    log.info(
      `public key → ${opts.public}\nsecret key → ${opts.secret} (back it up; set it as MINISIGN_SECRET_KEY in CI)`,
    );
  });

program
  .command('issues')
  .description(
    'open/close "Module X is failing" issues from health.json (needs GITHUB_TOKEN, GITHUB_REPOSITORY)',
  )
  .option('--dir <dir>', 'feed directory', '.feed')
  .option('--products <dir>', 'module directory', 'products')
  .action(async (opts: { dir: string; products: string }) => {
    const health = Health.parse(JSON.parse(await readFile(path.join(opts.dir, 'v1/health.json'), 'utf8')));
    const names = (await readdir(opts.products)).filter((n) => n.endsWith('.yaml') && !n.startsWith('_'));
    const files = await Promise.all(
      names.map(async (n) => ({ file: n, text: await readFile(path.join(opts.products, n), 'utf8') })),
    );
    const modules = validateModules(files).flatMap((r) => (r.module ? [r.module] : []));
    const runUrl = process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
    const actions = await syncModuleIssues(
      health,
      modules,
      githubIssues(env('GITHUB_REPOSITORY'), env('GITHUB_TOKEN')),
      runUrl,
    );
    log.info(actions.length ? actions.join('\n') : 'no issue changes');
  });

program
  .command('pr-report')
  .description('dry-run the given modules and write the module PR report (posted with --pr)')
  .requiredOption('--only <ids>', 'comma-separated module ids', (v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .option('--products <dir>', 'module directory', 'products')
  .option(
    '--pr <number>',
    'post or update the report comment on this PR (needs GITHUB_TOKEN, GITHUB_REPOSITORY)',
  )
  .option('--out <file>', 'also write the report to this file')
  .action(async (opts: { only: string[]; products: string; pr?: string; out?: string }) => {
    const names = (await readdir(opts.products)).filter((n) => n.endsWith('.yaml') && !n.startsWith('_'));
    const files = await Promise.all(
      names.map(async (n) => ({
        file: `products/${n}`,
        text: await readFile(path.join(opts.products, n), 'utf8'),
      })),
    );
    const modules = validateModules(files).flatMap((r) =>
      r.module && !r.issues.some((i) => i.level === 'error') ? [r.module] : [],
    );
    const valid = opts.only.filter((id) => modules.some((m) => m.id === id));
    const invalid = opts.only.filter((id) => !valid.includes(id));
    let published = new Set<string>();
    try {
      const index = FeedIndex.parse(
        await createFetcher().json(new URL('v1/index.json', DEFAULT_FEED).toString()),
      );
      published = new Set(Object.keys(index.products));
    } catch {
      log.info('no published index: every module counts as new');
    }
    const result = valid.length
      ? await runCollector({
          productsDir: path.resolve(opts.products),
          only: valid,
          out: path.resolve('.feed-pr'),
          previous: DEFAULT_FEED,
          dryRun: true,
          ...(process.env.GITHUB_TOKEN && { githubToken: process.env.GITHUB_TOKEN }),
          log,
        })
      : undefined;
    let report = moduleReport(result?.outcomes ?? [], modules, published);
    if (invalid.length) {
      const list = invalid.map((id) => '`' + id + '`').join(', ');
      report += `\n❌ Invalid module(s): ${list} — see the \`modules:validate\` step.\n`;
    }
    console.log(report);
    if (opts.out) await writeFile(opts.out, report);
    if (opts.pr) {
      const outcome = await upsertComment(
        env('GITHUB_REPOSITORY'),
        Number(opts.pr),
        report,
        env('GITHUB_TOKEN'),
      );
      log.info(`report comment ${outcome}`);
    }
    const failed = invalid.length > 0 || (result?.outcomes.some((o) => !o.result.ok) ?? false);
    process.exitCode = failed ? 1 : 0;
  });

await program.parseAsync();
