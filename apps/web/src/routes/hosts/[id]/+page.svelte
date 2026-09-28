<script lang="ts">
  // Host card (docs/specs/fleet-ui.md §5.C): status, where it is and how it's reached, the poll problem explained,
  // the products found on it and its history.
  import { pollBroken } from '@versiondrift/core';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Meta from '$lib/components/Meta.svelte';
  import FleetChip from '$lib/components/fleet/FleetChip.svelte';
  import { productCache } from '$lib/board/products.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import { fleetApi, type HostEvent } from '$lib/fleet/api';
  import { dateTime, hostLabel, instanceLabel, pollSummary } from '$lib/fleet/labels';
  import { fleetProductIds, fleetView } from '$lib/fleet/model';
  import { fleet, pollNow } from '$lib/fleet/state.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { i18n } from '$lib/i18n/context';
  import { isMessageKey, type MessageKey } from '$lib/i18n';

  const { t, locale } = $derived(i18n());
  $effect(() => {
    if (fleet.data) void productCache.ensure(fleetProductIds(fleet.data));
  });

  const id = $derived(page.params.id ?? '');
  const host = $derived(
    fleet.data
      ? fleetView(fleet.data, productCache.products, undefined).hosts.find((h) => h.id === id)
      : undefined,
  );
  const profile = $derived(fleet.data?.profiles.find((p) => p.id === host?.record.profileId));
  let events = $state<HostEvent[]>([]);
  let polling = $state(false);
  let toast = $state<string | undefined>();
  const loadEvents = (hostId: number) =>
    fleetApi
      .host(hostId)
      .then((h) => (events = h.events))
      .catch(() => (events = []));
  $effect(() => {
    const hostId = Number(id);
    if (Number.isInteger(hostId) && hostId > 0) void loadEvents(hostId);
  });

  async function poll() {
    if (!host) return;
    polling = true;
    try {
      const job = await pollNow([Number(host.id)]);
      toast = pollSummary(t, job);
      await loadEvents(Number(host.id));
    } catch (error) {
      toast = (error as Error).message;
    } finally {
      polling = false;
    }
  }
  async function trustNewKey() {
    if (!host) return;
    await fetch(`/api/hosts/${host.id}/reset-pins`, { method: 'POST' });
    await poll();
  }
  const canPoll = $derived(host?.record.profileId !== null && page.data.account?.role !== 'viewer');

  const broken = $derived(host ? pollBroken(host.poll.state) : false);
  const nameOf = (productId: string) => feed.index?.products[productId]?.name ?? productId;
  const since = $derived(host?.poll.since ? dateTime(host.poll.since, locale) : '');
  const errorTitle = $derived(
    host?.poll.state === 'auth-failed'
      ? t('pollErrorTitleAuth', { since })
      : host?.poll.state === 'unreachable'
        ? t('pollErrorTitleUnreachable', { since })
        : t('pollErrorTitleUnknown', { since }),
  );
  const explanation = $derived.by(() => {
    const code = host?.record.poll.errorCode;
    const key = `pollExplain_${code}`;
    if (code && isMessageKey(key)) return t(key);
    if (host?.poll.state === 'auth-failed')
      return code === 'password_expired' ? t('pollExplain_password_expired') : t('pollExplain_auth');
    if (host?.poll.state === 'unreachable') return t('pollExplain_timeout');
    return t('pollExplain_unknown');
  });
  const lastSuccess = $derived(
    host?.record.poll.lastSuccessAt ? dateTime(host.record.poll.lastSuccessAt, locale) : '',
  );

  function eventText(e: HostEvent): string {
    if (e.kind === 'version')
      return e.fromVersion
        ? t('eventVersion', {
            product: nameOf(e.productId ?? ''),
            from: e.fromVersion,
            to: e.toVersion ?? '',
          })
        : t('eventFound', { product: nameOf(e.productId ?? ''), to: e.toVersion ?? '' });
    const key = `eventPoll_${e.pollState}` as MessageKey;
    return e.message ?? t(key);
  }
  const KIND: Record<string, MessageKey> = {
    'ssh-linux': 'kind_ssh_linux',
    windows: 'kind_windows',
    routeros: 'kind_routeros',
    proxmox: 'kind_proxmox',
  };
</script>

<Meta title="{host?.record.name ?? t('hostsTitle')} · VersionDrift" description={t('appTagline')} />

<nav class="crumbs" aria-label="breadcrumb"><a href={resolve('/hosts')}>{t('hostsTitle')}</a> /</nav>

{#if fleet.error}
  <p class="error" role="alert">{fleet.error}</p>
{:else if !fleet.data}
  <p class="muted">{t('loading')}</p>
{:else if !host}
  <p class="muted">{t('unknownHost')}</p>
{:else}
  <header class="head">
    <div class="grow">
      <h1 class="mono">{host.record.name}</h1>
      <dl class="facts">
        <div>
          <dt>{t('hostAddress')}</dt>
          <dd class="mono">{host.record.address}</dd>
        </div>
        <div>
          <dt>{t('siteLabel')}</dt>
          <dd>{host.siteName}</dd>
        </div>
        <div>
          <dt>{t('hostKind')}</dt>
          <dd>{t(KIND[host.record.kind] ?? 'kind_ssh_linux')}</dd>
        </div>
        <div>
          <dt>{t('hostProfile')}</dt>
          <dd>
            {#if profile}<a href={resolve('/access-profiles')}>{profile.name}</a>{:else}{t('noProfile')}{/if}
          </dd>
        </div>
      </dl>
      {#if host.record.poll.lastAttemptAt}
        <p class="muted small">
          {t('hostPolled', { when: dateTime(host.record.poll.lastAttemptAt, locale) })}
        </p>
      {/if}
    </div>
    <div class="side">
      <FleetChip status={host.status.status} label={hostLabel(t, host.status, host.poll.state)} size="md" />
      {#if canPoll}
        <button class="primary" onclick={() => void poll()} disabled={polling}
          >{polling ? t('polling') : t('pollNow')}</button
        >
      {/if}
    </div>
  </header>

  {#if broken || host.poll.state === 'unknown'}
    <section class="problem" aria-labelledby="problem-title">
      <h2 id="problem-title">{errorTitle}</h2>
      <p>{explanation}</p>
      {#if host.record.poll.errorMessage}<p class="detail mono">{host.record.poll.errorMessage}</p>{/if}
      <p class="muted">
        {host.status.status === 'critical' ? t('lastKnownCritical') : t('lastKnown', { when: lastSuccess })}
      </p>
      {#if profile && host.poll.state === 'auth-failed'}
        <a class="button" href={resolve('/access-profiles')}>{t('openProfile')}</a>
      {/if}
      {#if canPoll && (host.record.poll.errorCode === 'host_key_mismatch' || host.record.poll.errorCode === 'tls_mismatch')}
        <button class="button" onclick={() => void trustNewKey()} disabled={polling}
          >{t('trustNewKey')}</button
        >
      {/if}
    </section>
  {/if}

  <section aria-labelledby="products-title">
    <h2 id="products-title">{t('productsTitle')}</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr
            ><th>{t('colProduct')}</th><th>{t('colVersion')}</th><th>{t('colStatus')}</th><th
              >{t('colSource')}</th
            ></tr
          >
        </thead>
        <tbody>
          {#each host.instances as inst (inst.productId + inst.version)}
            <tr>
              <td><a href={resolve('/p/[id]', { id: inst.productId })}>{nameOf(inst.productId)}</a></td>
              <td class="mono"
                >{inst.version}{#if inst.latest && inst.latest !== inst.version}<span class="arrow">→</span
                  >{inst.latest}{/if}</td
              >
              <td><FleetChip status={inst.status} label={instanceLabel(t, inst)} /></td>
              <td class="muted small"
                >{inst.source === 'manual'
                  ? t('sourceManual')
                  : broken
                    ? t('sourceLastKnown')
                    : t('sourceDetected')}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section aria-labelledby="history-title">
    <h2 id="history-title">{t('historyTitle')}</h2>
    {#if events.length === 0}
      <p class="muted">{t('noHistory')}</p>
    {:else}
      <ol class="history">
        {#each events as e, i (i)}
          <li><span class="muted mono small">{dateTime(e.at, locale)}</span> {eventText(e)}</li>
        {/each}
      </ol>
    {/if}
  </section>
{/if}

{#if toast}<Toast message={toast} onclose={() => (toast = undefined)} />{/if}

<style>
  .crumbs {
    font-size: 13px;
    margin-bottom: 8px;
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
  }
  .grow {
    flex: 1;
  }
  .side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
  }
  .primary {
    font-size: 14px;
    font-weight: 600;
    padding: 8px 14px;
    border-radius: 10px;
    background: var(--text);
    color: var(--bg);
    border: 1px solid var(--text);
  }
  h1 {
    margin: 0 0 10px;
    font-size: 26px;
  }
  h2 {
    font-size: 17px;
    margin: 0 0 10px;
  }
  section {
    margin-bottom: 24px;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 28px;
    margin: 0 0 8px;
  }
  .facts div {
    display: flex;
    flex-direction: column;
  }
  dt {
    font-size: 12px;
    color: var(--text-muted);
  }
  dd {
    margin: 0;
  }
  .problem {
    padding: 16px 18px;
    border: 1px dashed var(--stale-border);
    border-radius: 12px;
  }
  .problem p {
    margin: 0 0 8px;
  }
  .detail {
    font-size: 12.5px;
    color: var(--text-muted);
    word-break: break-word;
  }
  .button {
    display: inline-block;
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-strong);
    color: var(--text-soft);
    text-decoration: none;
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
  }
  th {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .arrow {
    margin: 0 8px;
    color: var(--text-muted);
  }
  .history {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .muted {
    color: var(--text-muted);
  }
  .small {
    font-size: 13px;
  }
  .error {
    color: var(--critical);
  }
</style>
