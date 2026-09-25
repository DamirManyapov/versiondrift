#!/usr/bin/env node
// pnpm collect … — see docs/04-collector.md "Local development".
import path from 'node:path';
import { Command } from 'commander';
import { COLLECTOR_VERSION, runCollector } from './run.ts';

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
  .option(
    '--previous <url|dir>',
    'previous feed (URL or directory containing v1/)',
    process.env.FEED_URL ?? 'https://feed.versiondrift.dev/',
  )
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
        log: { info: (m) => console.log(m), warn: (m) => console.warn(m) },
      });
      if (opts.dryRun) console.log(`\n${result.report}`);
      process.exitCode = result.exitCode;
    },
  );

await program.parseAsync();
