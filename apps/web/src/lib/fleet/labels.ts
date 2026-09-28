// Words for fleet statuses (docs/specs/fleet-ui.md §4): chips always carry text, never colour alone.
import type {
  AggregateKey,
  FleetInstance,
  FleetStatus,
  PollState,
  ProductAggregate,
} from '@versiondrift/core';
import type { Translate } from '$lib/i18n';

/** The chip of one instance: "CVSS 9.8", "EOL", "+3 releases", "Up to date", "Status unknown". */
export function instanceLabel(t: Translate, i: FleetInstance): string {
  if (i.status === 'critical')
    return i.cvss !== undefined ? `CVSS ${i.cvss.toFixed(1)}` : t('statusCritical');
  if (i.status === 'eol') return 'EOL';
  if (i.status === 'update') return t('releasesBehind', { n: i.behind });
  if (i.status === 'ok') return t('statusOk');
  return t('chipUnknown');
}

/** What a host without usable versions shows, by poll state. */
export function pollLabel(t: Translate, state: PollState): string {
  if (state === 'auth-failed') return t('chipNoAccess');
  if (state === 'unreachable') return t('chipNoConnection');
  if (state === 'unknown') return t('chipUnknown');
  return t('chipPending');
}

export function hostLabel(
  t: Translate,
  status: { status: FleetStatus; worst?: FleetInstance | undefined },
  poll: PollState,
): string {
  if (status.status === 'stale' || status.status === 'pending') return pollLabel(t, poll);
  return status.worst ? instanceLabel(t, status.worst) : t('chipUnknown');
}

const SEGMENT = {
  critical: 'segCritical',
  eol: 'segEol',
  update: 'segUpdate',
  ok: 'segOk',
  stale: 'segStale',
  unknown: 'segUnknown',
} as const;

export const segmentLabel = (t: Translate, key: AggregateKey, n: number) => t(SEGMENT[key], { n });

/** "3 behind · 1 EOL · 6 up to date": the aggregate's counts, worst first. */
export function summaryText(t: Translate, counts: ProductAggregate['counts']): string {
  return (['critical', 'eol', 'update', 'stale', 'unknown', 'ok'] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => segmentLabel(t, k, counts[k]))
    .join(' · ');
}

/** Local date and time of an ISO instant: "26.09.2026, 14:10" / "9/26/2026, 2:10 PM". */
export const dateTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

/** The toast after "Poll now": one host in words, several as a count with the problems named. */
export function pollSummary(
  t: Translate,
  job: { results: { name: string; state: string; changed: boolean }[] },
): string {
  const problems = job.results.filter((r) => r.state !== 'ok');
  const problemText = (r: { name: string; state: string }) =>
    `${r.name}: ${pollLabel(t, r.state as PollState).toLowerCase()}`;
  if (job.results.length === 1) {
    const r = job.results[0]!;
    if (r.state !== 'ok')
      return t('pollFailed', { host: r.name, problem: pollLabel(t, r.state as PollState).toLowerCase() });
    return t(r.changed ? 'pollChanged' : 'pollUnchanged', { host: r.name });
  }
  const head = t('pollMany', { n: job.results.length });
  return problems.length
    ? `${head} ${t('pollErrors', { list: problems.map(problemText).join(', ') })}`
    : head;
}

/** "18:00" in the browser's time. */
export const clockTime = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
