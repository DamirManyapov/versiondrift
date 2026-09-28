import { applyImport, importRows, planImport } from '@versiondrift/db';
import { attempt, json } from '$lib/server/api';
import { startPoll } from '$lib/server/poller';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/**
 * CSV import (docs/specs/fleet-ui.md §5.D), the body is the CSV text. `?dryRun=1` answers what each line would do;
 * without it the new and changed hosts are written and polled, and the answer carries that job.
 */
export const POST: RequestHandler = async ({ request, url }) => {
  const storage = selfHostedStorage();
  const plan = planImport(storage, importRows(await request.text()));
  if (url.searchParams.get('dryRun') === '1') return json({ rows: plan });
  const { created, updated } = attempt(() => applyImport(storage, plan));
  const polled = [...created, ...updated].filter(
    (id) => storage.fleet.hosts().find((h) => h.id === id)?.profileId !== null,
  );
  const job = polled.length ? startPoll(polled) : undefined;
  return json({ rows: plan, created: created.length, updated: updated.length, ...(job && { job }) });
};
