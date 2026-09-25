<script lang="ts">
  import { formatDate } from '$lib/format';
  import { i18n } from '$lib/i18n/context';
  import type { Row } from '$lib/board/rows';
  import StatusChip from './StatusChip.svelte';

  let { row, selected, onselect }: { row: Row; selected: boolean; onselect: () => void } = $props();
  const { t, locale } = $derived(i18n());
  const s = $derived(row.primary?.status);
  const behind = $derived.by(() => {
    if (!s || s.newer.length === 0) return '';
    const parts = [t('releasesBehind', { n: s.newer.length })];
    if (s.counts.security) parts.push(t('typeCount', { n: s.counts.security, type: t('typeSecurity') }));
    if (s.counts.breaking) parts.push(t('typeCount', { n: s.counts.breaking, type: t('typeBreaking') }));
    return parts.join(' · ');
  });
  const lastRelease = $derived(row.product?.releases.find((r) => !r.prerelease));
</script>

<button class="tile {row.status}" class:selected aria-pressed={selected} onclick={onselect} data-tile>
  <span class="head">
    <span class="title">
      <span class="name">{row.name}</span>
      <span class="muted">{row.category}</span>
    </span>
    {#if row.known}
      <StatusChip status={row.status} cvss={s?.maxCvss} />
    {:else}
      <span class="unknown">{t('unknownProduct')}</span>
    {/if}
  </span>
  <span class="mono versions">
    {#if s?.installed}
      <span>{s.installed}</span>
      {#if s.latest && s.newer.length > 0}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
          ><path d="M5 12h14M13 6l6 6-6 6" /></svg
        >
        <strong>{s.latest}</strong>
      {/if}
    {:else if s?.latest}
      <span class="muted">{t('latest')}:</span> <strong>{s.latest}</strong>
    {/if}
    {#if row.instances.length > 1}<span class="muted"
        >{t('moreInstances', { n: row.instances.length - 1 })}</span
      >{/if}
  </span>
  <span class="behind">{behind}</span>
  <span class="grow"></span>
  <span class="foot">
    <span class="grow"
      >{lastRelease
        ? t('lastRelease', { date: formatDate(lastRelease.date ?? lastRelease.firstSeenAt, locale) })
        : ''}</span
    >
    {#if row.newThisWeek}<span class="badge">{t('newThisWeek')}</span>{/if}
  </span>
</button>

<style>
  .tile {
    min-height: 172px;
    width: 100%;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition:
      filter 0.12s ease,
      box-shadow 0.12s ease;
  }
  .tile:hover {
    filter: brightness(1.08);
  }
  .critical {
    background: var(--critical-bg);
    border-color: var(--critical-border);
  }
  .update {
    background: var(--update-bg);
    border-color: var(--update-border);
  }
  .eol {
    background: var(--eol-bg);
    border-color: var(--eol-border);
  }
  .ok {
    border-color: var(--ok-border);
  }
  .stale {
    border-style: dashed;
    border-color: var(--stale-border);
  }
  .selected {
    box-shadow: 0 0 0 2px var(--text);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
  }
  .title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-grow: 1;
  }
  .name {
    font-size: 17px;
    font-weight: 600;
  }
  .muted {
    font-size: 12px;
    color: var(--text-muted);
  }
  .unknown {
    font-size: 12px;
    color: var(--text-muted);
    border: 1px dashed var(--border-strong);
    border-radius: 6px;
    padding: 3px 6px;
  }
  .versions {
    overflow-wrap: anywhere;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    flex-wrap: wrap;
  }
  svg {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .behind {
    font-size: 13px;
    color: var(--text-soft);
  }
  .grow {
    flex-grow: 1;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    font-size: 12px;
    color: var(--text-muted);
  }
  .badge {
    white-space: nowrap;
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--stale-border);
    color: var(--text);
  }
</style>
