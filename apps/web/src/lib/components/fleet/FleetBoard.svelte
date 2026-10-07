<script lang="ts">
  // The self-hosted board with hosts (docs/specs/fleet-ui.md §5.A): products aggregated over the hosts of the
  // chosen site, a summary strip with poll problems, and the version breakdown of the selected product.
  import type { Snippet } from 'svelte';
  import { fleetSummary, type AggregateKey, type SummaryKey } from '@versiondrift/core';
  import { resolve } from '$app/paths';
  import { productCache } from '$lib/board/products.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import type { FleetData } from '$lib/fleet/api';
  import { fleetProductIds, fleetView } from '$lib/fleet/model';
  import { i18n } from '$lib/i18n/context';
  import FleetPanel from './FleetPanel.svelte';
  import FleetTile from './FleetTile.svelte';

  let {
    data,
    site,
    ontoast,
    below,
    other,
    onpick,
    overlay = $bindable(false),
  }: {
    data: FleetData;
    site: number | undefined;
    ontoast: (m: string) => void;
    /** Under the tiles, in the same column (the products without a host). */
    below?: Snippet;
    /** The one detail panel shows something else (a product without a host): no fleet tile is selected then. */
    other?: Snippet | undefined;
    /** A fleet tile was clicked. */
    onpick?: () => void;
    /** Narrow screens: the panel is open as a full-screen layer (the page opens it for host-less picks too). */
    overlay?: boolean;
  } = $props();
  const { t } = $derived(i18n());

  $effect(() => void productCache.ensure(fleetProductIds(data)));

  const RANK: Record<AggregateKey, number> = { critical: 0, eol: 1, update: 2, unknown: 3, ok: 4, stale: 5 };
  const view = $derived(fleetView(data, productCache.products, site));
  const nameOf = (id: string) => feed.index?.products[id]?.name ?? productCache.products[id]?.name ?? id;
  const categoryOf = (id: string) => feed.index?.products[id]?.category ?? 'other';
  const tiles = $derived(
    [...view.aggregates].sort(
      (a, b) => RANK[a.status] - RANK[b.status] || nameOf(a.productId).localeCompare(nameOf(b.productId)),
    ),
  );
  const summary = $derived(fleetSummary(view.aggregates, view.hosts));

  let status = $state<SummaryKey | undefined>();
  let selectedId = $state<string | undefined>();
  const shown = $derived(status ? tiles.filter((a) => a.status === status) : tiles);
  const selected = $derived(other ? undefined : (shown.find((a) => a.productId === selectedId) ?? shown[0]));

  const SUMMARY: {
    key: SummaryKey;
    label: 'summaryCritical' | 'summaryEol' | 'summaryUpdate' | 'summaryOk';
  }[] = [
    { key: 'critical', label: 'summaryCritical' },
    { key: 'eol', label: 'summaryEol' },
    { key: 'update', label: 'summaryUpdate' },
    { key: 'ok', label: 'summaryOk' },
  ];

  // Narrow screens: Escape closes the layer; opening it moves focus to "← Back".
  let back = $state<HTMLButtonElement>();
  $effect(() => {
    if (overlay && window.matchMedia('(max-width: 1100px)').matches) back?.focus();
  });
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && overlay && window.matchMedia('(max-width: 1100px)').matches)
      overlay = false;
  }

  function chipLabel(id: string): string {
    const a = view.aggregates.find((x) => x.productId === id);
    if (!a) return '';
    if (a.status === 'critical') {
      const cvss = Math.max(0, ...a.entries.map((e) => (e.key === 'critical' ? (e.instance.cvss ?? 0) : 0)));
      return cvss > 0 ? `CVSS ${cvss.toFixed(1)}` : t('statusCritical');
    }
    if (a.status === 'eol') return 'EOL';
    if (a.status === 'update') return t('statusUpdate');
    if (a.status === 'ok') return t('statusOk');
    return a.status === 'stale' ? t('chipNoConnection') : t('chipUnknown');
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="summary">
  {#each SUMMARY as item (item.key)}
    <!-- A filter: nothing to filter when the count is 0 (UI audit P1-1). -->
    <button
      type="button"
      class="stat {item.key}"
      aria-pressed={status === item.key}
      disabled={summary[item.key] === 0 && status !== item.key}
      onclick={() => (status = status === item.key ? undefined : item.key)}
    >
      <span class="label"><span class="dot"></span>{t(item.label)}</span>
      <span class="n">{summary[item.key]}</span>
      <span class="muted">{t('productsNoun', { n: summary[item.key] })}</span>
    </button>
  {/each}
  <!-- Not a filter but a way to the hosts list: says so with an arrow and its accessible name. -->
  {#if summary.pollProblems > 0}
    <a
      class="stat poll"
      href="{resolve('/hosts')}?poll=problem"
      aria-label={t('pollProblemsLink', { n: summary.pollProblems })}
    >
      <span class="label"
        ><span class="dot"></span>{t('pollProblems')}<span class="go" aria-hidden="true">→</span></span
      >
      <span class="n">{summary.pollProblems}</span>
      <span class="muted">{t('hostsNoun', { n: summary.pollProblems })}</span>
    </a>
  {:else}
    <div class="stat poll off">
      <span class="label"><span class="dot"></span>{t('pollProblems')}</span>
      <span class="n">0</span>
      <span class="muted">{t('hostsNoun', { n: 0 })}</span>
    </div>
  {/if}
</div>

{#if status}
  <p class="shown" role="status">
    {t('filterShown', {
      what: t(SUMMARY.find((s) => s.key === status)!.label),
      n: shown.length,
      noun: t('productsNoun', { n: shown.length }),
    })}
    <button type="button" class="btn btn-sm btn-ghost" onclick={() => (status = undefined)}
      >✕ {t('clearFilter')}</button
    >
  </p>
{/if}

<!-- One detail panel for the whole board (UI audit, board 1): a fleet product or one without a host. -->
<div class="layout">
  <div class="left">
    <div class="grid">
      {#each shown as aggregate (aggregate.productId)}
        <FleetTile
          {aggregate}
          product={productCache.products[aggregate.productId]}
          name={nameOf(aggregate.productId)}
          category={categoryOf(aggregate.productId)}
          selected={selected?.productId === aggregate.productId}
          onselect={() => {
            selectedId = aggregate.productId;
            overlay = true;
            onpick?.();
          }}
        />
      {/each}
    </div>
    {@render below?.()}
  </div>
  {#if other || selected}
    <div class="right" class:overlay>
      <button type="button" class="btn btn-sm back" bind:this={back} onclick={() => (overlay = false)}
        >← {t('back')}</button
      >
      {#if other}{@render other()}{:else if selected}
        <FleetPanel
          aggregate={selected}
          product={productCache.products[selected.productId]}
          name={nameOf(selected.productId)}
          category={categoryOf(selected.productId)}
          chipLabel={chipLabel(selected.productId)}
          {ontoast}
        />{/if}
    </div>
  {/if}
</div>

<style>
  .summary {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }
  .stat {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 8px;
    align-items: baseline;
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    text-align: left;
    text-decoration: none;
    font: inherit;
    cursor: pointer;
    transition:
      background-color 0.12s,
      border-color 0.12s;
  }
  .stat:hover:not(:disabled, .off) {
    background: var(--surface-hover);
    color: var(--text);
  }
  .stat:active:not(:disabled, .off) {
    background: var(--surface-active);
  }
  /* The active filter takes its status colour: fill, border, dot and number. */
  .stat[aria-pressed='true'] {
    box-shadow: 0 0 0 1px currentColor;
  }
  .stat.critical[aria-pressed='true'] {
    background: var(--critical-bg);
    border-color: var(--critical);
    color: var(--critical);
  }
  .stat.eol[aria-pressed='true'] {
    background: var(--eol-bg);
    border-color: var(--eol);
    color: var(--eol);
  }
  .stat.update[aria-pressed='true'] {
    background: var(--update-bg);
    border-color: var(--update);
    color: var(--update);
  }
  .stat.ok[aria-pressed='true'] {
    background: var(--ok-bg);
    border-color: var(--ok);
    color: var(--ok);
  }
  .stat[aria-pressed='true'] .label {
    color: var(--text);
  }
  .stat:disabled,
  .stat.off {
    opacity: 0.5;
    cursor: default;
  }
  .go {
    margin-left: auto;
    color: var(--text-muted);
  }
  .shown {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 14px;
    font-size: 14px;
    color: var(--text-soft);
  }
  .label {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .critical .dot {
    background: var(--critical);
  }
  .eol .dot {
    background: var(--eol);
  }
  .update .dot {
    background: var(--update);
  }
  .ok .dot {
    background: var(--ok);
  }
  .poll .dot {
    border: 1.5px solid var(--text-muted);
  }
  .n {
    font-size: 26px;
    font-weight: 600;
    line-height: 1.2;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 24px;
    align-items: start;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
  .right {
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
  }
  .back {
    display: none;
  }
  /* Narrow screens: the panel is a full-screen layer with "← Back" on top (UI audit P2). */
  @media (max-width: 1100px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .right {
      display: none;
    }
    .right.overlay {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 40;
      max-height: none;
      overflow-y: auto;
      background: var(--bg);
      padding: calc(12px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));
    }
    .right.overlay .back {
      display: inline-flex;
      margin-bottom: 12px;
    }
    .summary {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }
  }
  /* Phones (UI audit P2): the summary tiles are a strip that scrolls sideways, not a 2×3 grid. */
  @media (max-width: 640px) {
    .summary {
      display: flex;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      gap: 10px;
      margin-left: -16px;
      margin-right: -16px;
      padding: 0 16px 4px;
    }
    .summary > :global(*) {
      flex: 0 0 auto;
      min-width: 148px;
      scroll-snap-align: start;
    }
  }
</style>
