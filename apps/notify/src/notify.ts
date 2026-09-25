// One notify run (docs/09 S2-T9): statuses for every instance in the inventory, compared with what was sent last
// time; a message only when something changed for the worse or a new release appeared. First run = one summary.
import {
  computeStatus,
  DEFAULT_SETTINGS,
  type ProductStatus,
  type Status,
  type StatusSettings,
} from '@versiondrift/core';
import {
  inventoryEntries,
  type FeedProduct,
  type InstanceSpec,
  type Inventory,
  type ItemType,
} from '@versiondrift/schema';
import type { Feed } from './feed.ts';
import { STATUS_LABEL, TEXT, type Lang } from './i18n.ts';
import { escapeHtml as esc } from './telegram.ts';

export interface InstanceState {
  status: Status;
  latest: string | null;
  advisories: string[];
  eolSoon: boolean;
}

export interface NotifyState {
  version: 1;
  initializedAt?: string;
  lastDigestAt?: string;
  instances: Record<string, InstanceState>;
}

export const EMPTY_STATE: NotifyState = { version: 1, instances: {} };

export interface Checked {
  key: string;
  board: string;
  product: FeedProduct;
  instance: InstanceSpec;
  status: ProductStatus;
}

export interface NotifyOptions {
  lang: Lang;
  now: Date;
  settings?: StatusSettings;
  /** Weekday (0 = Sunday … 6 = Saturday, UTC) for the weekly digest; null = never. */
  digestDay: number | null;
}

export interface NotifyResult {
  messages: string[];
  state: NotifyState;
  checked: Checked[];
  problems: string[];
}

const WEEK = 7 * 86_400_000;

function instanceKey(board: string, productId: string, instance: InstanceSpec, index: number): string {
  return `${board}/${productId}/${instance.host ?? instance.label ?? `#${index}`}`;
}

function where(c: Checked): string {
  const who = c.instance.host ?? c.instance.label;
  return who ? ` · ${esc(who)}` : '';
}

function typeSummary(lang: Lang, counts: Record<ItemType, number>): string {
  const names = TEXT[lang].types;
  return (Object.keys(counts) as ItemType[])
    .filter((t) => counts[t] > 0 && t !== 'other')
    .map((t) => `${counts[t]} ${names[t]}`)
    .join(', ');
}

function releaseLink(lang: Lang, product: FeedProduct, version: string | null): string {
  const release = product.releases.find((r) => r.version === version);
  return release?.url ? ` · <a href="${esc(release.url)}">${TEXT[lang].notes}</a>` : '';
}

function line(lang: Lang, c: Checked): string {
  const s = c.status;
  const head = `<b>${esc(c.product.name)}</b> ${esc(s.installed ?? '')}${s.latest && s.latest !== s.installed ? ` → ${esc(s.latest)}` : ''}${where(c)}`;
  return `${STATUS_LABEL[lang][s.status].split(' ')[0]} ${head}`;
}

function eventMessage(lang: Lang, c: Checked, kinds: string[]): string {
  const t = TEXT[lang];
  const s = c.status;
  const lines = [line(lang, c)];
  for (const kind of kinds) {
    if (kind === 'critical') {
      lines.push(
        `${t.critical}: ${s.affecting.map((a) => `${esc(a.id)}${a.cvss ? ` (CVSS ${a.cvss.score})` : ''}`).join(', ')}`,
      );
    } else if (kind === 'eol') {
      lines.push(`${t.eol}${s.branch?.eolDate ? ` (${s.branch.eolDate})` : ''}`);
    } else if (kind === 'eolSoon') {
      lines.push(t.eolSoon(s.branch?.eolDate ?? '?'));
    } else if (kind === 'update') {
      const summary = typeSummary(lang, s.counts);
      lines.push(
        `${t.update}: ${t.newer(s.newer.length)}${summary ? ` (${summary})` : ''}${releaseLink(lang, c.product, s.latest)}`,
      );
    } else if (kind === 'invalid') {
      lines.push(t.invalid(esc(s.installed ?? '')));
    }
  }
  if (s.newestOverall && kinds.some((k) => k === 'update' || k === 'eol'))
    lines.push(t.otherTrack(esc(s.newestOverall)));
  return lines.join('\n');
}

/** What changed for this instance since the last run. */
function eventsFor(previous: InstanceState | undefined, s: ProductStatus): string[] {
  const kinds: string[] = [];
  const advisories = s.affecting.map((a) => a.id);
  if (
    s.status === 'critical' &&
    (previous?.status !== 'critical' || advisories.some((id) => !previous.advisories.includes(id)))
  ) {
    kinds.push('critical');
  }
  if (s.status === 'eol' && previous?.status !== 'eol') kinds.push('eol');
  if (s.flags.includes('eolSoon') && !previous?.eolSoon) kinds.push('eolSoon');
  if (
    s.newer.length > 0 &&
    (previous === undefined || previous.status === 'ok' || previous.latest !== s.latest)
  )
    kinds.push('update');
  if (s.flags.includes('invalidVersion') && previous?.status !== 'news') kinds.push('invalid');
  return kinds;
}

const NEEDS_ATTENTION: Status[] = ['critical', 'eol', 'update'];

function summary(lang: Lang, checked: Checked[], title: string): string {
  const t = TEXT[lang];
  const attention = checked
    .filter((c) => NEEDS_ATTENTION.includes(c.status.status) || c.status.flags.includes('invalidVersion'))
    .sort((a, b) => NEEDS_ATTENTION.indexOf(a.status.status) - NEEDS_ATTENTION.indexOf(b.status.status));
  const lines = [title];
  if (attention.length === 0) lines.push(t.allGood);
  else lines.push('', t.needAttention, ...attention.map((c) => line(lang, c)));
  return lines.join('\n');
}

function shippedThisWeek(lang: Lang, checked: Checked[], now: Date): string[] {
  const since = now.getTime() - WEEK;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of checked) {
    if (seen.has(c.product.id)) continue;
    seen.add(c.product.id);
    for (const r of c.product.releases) {
      if (r.prerelease || Date.parse(r.date ?? r.firstSeenAt) < since) continue;
      out.push(
        `• <b>${esc(c.product.name)}</b> ${esc(r.version)}${r.url ? ` · <a href="${esc(r.url)}">${TEXT[lang].notes}</a>` : ''}`,
      );
    }
  }
  return out;
}

export async function runNotify(
  inventory: Inventory,
  feed: Feed,
  state: NotifyState,
  options: NotifyOptions,
): Promise<NotifyResult> {
  const settings = options.settings ?? DEFAULT_SETTINGS;
  const problems: string[] = [];
  const checked: Checked[] = [];
  for (const entry of inventoryEntries(inventory)) {
    const product = await feed.product(entry.productId);
    if (!product) {
      problems.push(TEXT[options.lang].unknownProduct(entry.productId));
      continue;
    }
    entry.instances.forEach((instance, index) => {
      const status = computeStatus(
        product,
        {
          productId: entry.productId,
          version: instance.version,
          ...(instance.track && { track: instance.track }),
        },
        settings,
        options.now,
      );
      checked.push({
        key: instanceKey(entry.board, entry.productId, instance, index),
        board: entry.board,
        product,
        instance,
        status,
      });
    });
  }

  const messages: string[] = [];
  const nowIso = options.now.toISOString();
  const firstRun = state.initializedAt === undefined;
  if (firstRun) {
    const head = TEXT[options.lang].firstRun(checked.length);
    messages.push([summary(options.lang, checked, head), ...problems.map((p) => `⚠️ ${esc(p)}`)].join('\n'));
  } else {
    for (const c of checked) {
      const kinds = eventsFor(state.instances[c.key], c.status);
      if (kinds.length > 0) messages.push(eventMessage(options.lang, c, kinds));
    }
  }

  let lastDigestAt = state.lastDigestAt;
  const digestDue =
    !firstRun &&
    options.digestDay !== null &&
    options.now.getUTCDay() === options.digestDay &&
    (lastDigestAt === undefined || options.now.getTime() - Date.parse(lastDigestAt) > WEEK - 86_400_000);
  if (digestDue) {
    const t = TEXT[options.lang];
    const shipped = shippedThisWeek(options.lang, checked, options.now);
    messages.push(
      [
        summary(options.lang, checked, `📋 <b>${t.digest}</b>`),
        ...(shipped.length ? ['', t.shippedThisWeek, ...shipped] : []),
      ].join('\n'),
    );
    lastDigestAt = nowIso;
  }

  const instances: Record<string, InstanceState> = {};
  for (const c of checked) {
    instances[c.key] = {
      status: c.status.status,
      latest: c.status.latest,
      advisories: c.status.affecting.map((a) => a.id),
      eolSoon: c.status.flags.includes('eolSoon'),
    };
  }
  return {
    messages,
    checked,
    problems,
    state: {
      version: 1,
      initializedAt: state.initializedAt ?? nowIso,
      ...(lastDigestAt && { lastDigestAt }),
      instances,
    },
  };
}
