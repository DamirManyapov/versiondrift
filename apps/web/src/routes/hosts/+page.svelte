<script lang="ts">
  // Hosts table (docs/specs/fleet-ui.md §5.B): filters as URL parameters with live counts, search, grouping by site,
  // rows sorted by severity then name.
  import type { FleetStatus } from '@versiondrift/core';
  import { pollBroken } from '@versiondrift/core';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Meta from '$lib/components/Meta.svelte';
  import FleetChip from '$lib/components/fleet/FleetChip.svelte';
  import { productCache } from '$lib/board/products.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import { dateTime, hostLabel, pollSummary, summaryText } from '$lib/fleet/labels';
  import { fleetProductIds, fleetView, type FleetHostView } from '$lib/fleet/model';
  import { fleet, pollNow, siteFrom } from '$lib/fleet/state.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { i18n } from '$lib/i18n/context';
  import type { MessageKey } from '$lib/i18n';

  const { t, locale } = $derived(i18n());
  $effect(() => {
    if (fleet.data) void productCache.ensure(fleetProductIds(fleet.data));
  });

  const RANK: Record<FleetStatus | 'stale', number> = {
    critical: 0,
    eol: 1,
    update: 2,
    unknown: 3,
    stale: 4,
    pending: 5,
    ok: 6,
  };
  const params = $derived(page.url.searchParams);
  const status = $derived(params.get('status') ?? 'all');
  const poll = $derived(params.get('poll') ?? 'any');
  const kind = $derived(params.get('kind') ?? 'all');
  const grouped = $derived(params.get('group') !== 'none');
  let query = $state(page.url.searchParams.get('q') ?? '');

  const site = $derived(siteFrom(page.url, fleet.data));
  const all = $derived(fleet.data ? fleetView(fleet.data, productCache.products, site).hosts : []);
  const statusOf = (h: FleetHostView) => h.status.status;
  const matches = (h: FleetHostView, f: { status?: string; poll?: string; kind?: string }) =>
    (f.status === undefined || f.status === 'all' || statusOf(h) === f.status) &&
    (f.poll === undefined || f.poll === 'any' || pollBroken(h.poll.state)) &&
    (f.kind === undefined || f.kind === 'all' || h.record.kind === f.kind);
  const searched = $derived(
    all.filter((h) => {
      const q = query.trim().toLowerCase();
      return (
        q === '' || h.record.name.toLowerCase().includes(q) || h.record.address.toLowerCase().includes(q)
      );
    }),
  );
  const visible = $derived(
    searched
      .filter((h) => matches(h, { status, poll, kind }))
      .sort((a, b) => RANK[statusOf(a)] - RANK[statusOf(b)] || a.record.name.localeCompare(b.record.name)),
  );
  const count = (f: { status?: string; poll?: string; kind?: string }) =>
    searched.filter((h) => matches(h, { status, poll, kind, ...f })).length;
  const groups = $derived(
    grouped
      ? (fleet.data?.sites ?? [])
          .map((s) => ({ site: s, hosts: visible.filter((h) => h.record.siteId === s.id) }))
          .filter((g) => g.hosts.length > 0)
      : [{ site: undefined, hosts: visible }],
  );

  // Selection: the header box takes only the rows the filters show; the bar says when some are hidden.
  let selected = $state<number[]>([]);
  let polling = $state(false);
  let toast = $state<string | undefined>();
  const visibleIds = $derived(visible.map((h) => h.record.id));
  const allVisible = $derived(visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id)));
  const hiddenSelected = $derived(selected.filter((id) => !visibleIds.includes(id)).length);
  const canEdit = $derived(page.data.account?.role !== 'viewer');
  const toggle = (id: number) =>
    (selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleVisible = () =>
    (selected = allVisible
      ? selected.filter((id) => !visibleIds.includes(id))
      : [...new Set([...selected, ...visibleIds])]);

  async function pollSelected() {
    polling = true;
    try {
      toast = pollSummary(t, await pollNow(selected));
    } catch (error) {
      toast = (error as Error).message;
    } finally {
      polling = false;
    }
  }

  function setParam(key: string, value: string, fallback: string) {
    const url = new URL(page.url);
    if (value === fallback) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  const STATUSES: { id: string; key: MessageKey }[] = [
    { id: 'all', key: 'filterAll' },
    { id: 'critical', key: 'statusCritical' },
    { id: 'eol', key: 'summaryEol' },
    { id: 'update', key: 'filterBehind' },
    { id: 'ok', key: 'statusOk' },
  ];
  const KINDS: { id: string; key: MessageKey }[] = [
    { id: 'all', key: 'filterAll' },
    { id: 'ssh-linux', key: 'kind_ssh_linux' },
    { id: 'windows', key: 'kind_windows' },
    { id: 'routeros', key: 'kind_routeros' },
    { id: 'proxmox', key: 'kind_proxmox' },
  ];
  // "Windows Server 2022 · 20348.5499", "MikroTik RouterOS 7.23.4 · long-term", "Debian GNU/Linux 12.12".
  const osOf = (h: FleetHostView) => {
    const first = h.record.instances[0];
    if (!first) return '—';
    const name = feed.index?.products[first.productId]?.name ?? first.productId;
    const version = first.version ?? '';
    const track = productCache.products[first.productId]?.tracks.find((tr) => tr.id === first.track);
    if (track?.label) return `${name} ${version} · ${track.label}`;
    if (track && !version.startsWith(track.id)) return `${name} ${track.id} · ${version}`;
    return `${name} ${version}`.trim();
  };
  const problemOf = (h: FleetHostView) => {
    const since = h.poll.since ? dateTime(h.poll.since, locale) : '';
    if (h.poll.state === 'unreachable') return t('problemUnreachable', { since });
    if (h.poll.state === 'auth-failed') return t('problemAuth', { since });
    if (h.poll.state === 'unknown') return t('problemUnknown', { since });
    return '';
  };
  const groupSummary = (hosts: FleetHostView[]) => {
    const counts = { critical: 0, eol: 0, update: 0, unknown: 0, ok: 0, stale: 0 };
    for (const h of hosts) {
      const s = statusOf(h);
      if (s !== 'pending') counts[s]++;
    }
    return summaryText(t, counts);
  };
</script>

<Meta title="{t('hostsTitle')} · VersionDrift" description={t('appTagline')} />

{#if fleet.error}
  <p class="error" role="alert">{fleet.error}</p>
{:else if !fleet.data}
  <p class="muted">{t('loading')}</p>
{:else}
  <div class="top">
    <h1>{t('hostsTitle')} <span class="muted n">{all.length}</span></h1>
    <input
      class="search"
      type="search"
      bind:value={query}
      placeholder={t('searchHosts')}
      aria-label={t('searchHosts')}
    />
    <div class="toggle" role="group">
      <button aria-pressed={grouped} onclick={() => setParam('group', 'site', 'site')}
        >{t('groupBySite')}</button
      >
      <button aria-pressed={!grouped} onclick={() => setParam('group', 'none', 'site')}
        >{t('groupNone')}</button
      >
    </div>
  </div>

  <div class="filters">
    <div class="fgroup" role="group" aria-label={t('filterStatus')}>
      <span class="muted">{t('filterStatus')}</span>
      {#each STATUSES as s (s.id)}
        <button class="chip" aria-pressed={status === s.id} onclick={() => setParam('status', s.id, 'all')}
          >{t(s.key)} <span class="c">{count({ status: s.id })}</span></button
        >
      {/each}
    </div>
    <div class="fgroup" role="group" aria-label={t('filterPoll')}>
      <span class="muted">{t('filterPoll')}</span>
      <button class="chip" aria-pressed={poll === 'any'} onclick={() => setParam('poll', 'any', 'any')}
        >{t('pollAny')} <span class="c">{count({ poll: 'any' })}</span></button
      >
      <button
        class="chip"
        aria-pressed={poll === 'problem'}
        onclick={() => setParam('poll', 'problem', 'any')}
        >{t('pollProblems')} <span class="c">{count({ poll: 'problem' })}</span></button
      >
    </div>
    <div class="fgroup" role="group" aria-label={t('filterKind')}>
      <span class="muted">{t('filterKind')}</span>
      {#each KINDS as k (k.id)}
        <button class="chip" aria-pressed={kind === k.id} onclick={() => setParam('kind', k.id, 'all')}
          >{t(k.key)} <span class="c">{count({ kind: k.id })}</span></button
        >
      {/each}
    </div>
  </div>

  {#if selected.length > 0}
    <div class="bulk" role="region" aria-label={t('selectedHosts', { n: selected.length })}>
      <strong>{t('selectedHosts', { n: selected.length })}</strong>
      {#if hiddenSelected > 0}<span class="muted">{t('hiddenSelected', { n: hiddenSelected })}</span>{/if}
      <span class="grow"></span>
      <button class="primary" onclick={() => void pollSelected()} disabled={polling}
        >{polling ? t('polling') : t('pollNow')}</button
      >
      <button onclick={() => (selected = [])}>{t('clearSelection')}</button>
    </div>
  {/if}

  {#if visible.length === 0}
    <p class="muted">{t('noHostsMatch')}</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            {#if canEdit}
              <th class="check">
                <input
                  type="checkbox"
                  checked={allVisible}
                  onchange={toggleVisible}
                  aria-label={t('selectVisible', { n: visibleIds.length })}
                />
              </th>
            {/if}
            <th>{t('colStatus')}</th>
            <th>{t('colHost')}</th>
            <th>{t('colSite')}</th>
            <th>{t('colOs')}</th>
            <th>{t('colProducts')}</th>
            <th>{t('colPolled')}</th>
            <th>{t('colProblem')}</th>
          </tr>
        </thead>
        {#each groups as group (group.site?.id ?? 'all')}
          <tbody>
            {#if group.site}
              <tr class="site">
                <th colspan={canEdit ? 8 : 7} scope="colgroup"
                  >{group.site.name} · {t('hosts', { n: group.hosts.length })} · {groupSummary(
                    group.hosts,
                  )}</th
                >
              </tr>
            {/if}
            {#each group.hosts as host (host.id)}
              <tr class:picked={selected.includes(host.record.id)}>
                {#if canEdit}
                  <td class="check">
                    <input
                      type="checkbox"
                      checked={selected.includes(host.record.id)}
                      onchange={() => toggle(host.record.id)}
                      aria-label={t('selectHost', { host: host.record.name })}
                    />
                  </td>
                {/if}
                <td
                  ><FleetChip
                    status={host.status.status}
                    label={hostLabel(t, host.status, host.poll.state)}
                  /></td
                >
                <td>
                  <a class="name mono" href={resolve('/hosts/[id]', { id: host.id })}>{host.record.name}</a>
                  <span class="addr mono">{host.record.address}</span>
                </td>
                <td>{host.siteName}</td>
                <td class="mono">{osOf(host)}</td>
                <td class="mono">{host.record.instances.length}</td>
                <td class="muted"
                  >{host.record.poll.lastAttemptAt
                    ? dateTime(host.record.poll.lastAttemptAt, locale)
                    : host.record.profileId === null
                      ? t('noProfile')
                      : t('neverPolled')}</td
                >
                <td class="problem">{problemOf(host)}</td>
              </tr>
            {/each}
          </tbody>
        {/each}
      </table>
    </div>
  {/if}
{/if}

{#if toast}<Toast message={toast} onclose={() => (toast = undefined)} />{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  h1 {
    margin: 0;
    font-size: 26px;
  }
  .n {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 400;
  }
  .search {
    flex: 1;
    min-width: 200px;
    max-width: 360px;
    font: inherit;
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
  }
  .toggle {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    overflow: hidden;
  }
  .toggle button {
    padding: 7px 12px;
    font-size: 13px;
    border-radius: 0;
  }
  .toggle button[aria-pressed='true'],
  .chip[aria-pressed='true'] {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }
  .fgroup {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .fgroup > .muted {
    min-width: 70px;
    font-size: 13px;
  }
  .chip {
    font-size: 13px;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    color: var(--text-soft);
  }
  .c {
    font-family: var(--font-mono);
    color: var(--text-muted);
    margin-left: 4px;
  }
  .chip[aria-pressed='true'] .c {
    color: inherit;
  }
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th,
  td {
    text-align: left;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  thead th {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  tr.site th {
    background: var(--surface-2);
    font-size: 13px;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-soft);
  }
  .name {
    display: block;
    color: var(--text);
    font-weight: 500;
  }
  .addr {
    font-size: 12px;
    color: var(--text-muted);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .muted {
    color: var(--text-muted);
  }
  .problem {
    color: var(--text-soft);
    font-size: 13px;
  }
  .error {
    color: var(--critical);
  }
  .check {
    width: 36px;
  }
  tr.picked td {
    background: var(--surface-2);
  }
  .bulk {
    position: sticky;
    top: 8px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 14px;
    margin-bottom: 12px;
    border-radius: 12px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }
  .grow {
    flex: 1;
  }
  .bulk button {
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-strong);
    color: var(--text-soft);
  }
  .bulk .primary {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
    font-weight: 600;
  }
</style>
