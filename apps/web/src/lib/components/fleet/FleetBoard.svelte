<script lang="ts">
  // The self-hosted board with hosts (docs/specs/fleet-ui.md §5.A): products aggregated over the hosts of the
  // chosen site, a summary strip with poll problems, and the version breakdown of the selected product.
  import { fleetSummary, type AggregateKey, type SummaryKey } from '@versiondrift/core';
  import { resolve } from '$app/paths';
  import { productCache } from '$lib/board/products.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import type { FleetData } from '$lib/fleet/api';
  import { fleetProductIds, fleetView } from '$lib/fleet/model';
  import { i18n } from '$lib/i18n/context';
  import FleetPanel from './FleetPanel.svelte';
  import FleetTile from './FleetTile.svelte';

  let { data, site, ontoast }: { data: FleetData; site: number | undefined; ontoast: (m: string) => void } =
    $props();
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
  const selected = $derived(shown.find((a) => a.productId === selectedId) ?? shown[0]);

  const SUMMARY: {
    key: SummaryKey;
    label: 'summaryCritical' | 'summaryEol' | 'summaryUpdate' | 'summaryOk';
  }[] = [
    { key: 'critical', label: 'summaryCritical' },
    { key: 'eol', label: 'summaryEol' },
    { key: 'update', label: 'summaryUpdate' },
    { key: 'ok', label: 'summaryOk' },
  ];

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

<div class="summary">
  {#each SUMMARY as item (item.key)}
    <button
      class="stat {item.key}"
      aria-pressed={status === item.key}
      onclick={() => (status = status === item.key ? undefined : item.key)}
    >
      <span class="label"><span class="dot"></span>{t(item.label)}</span>
      <span class="n">{summary[item.key]}</span>
      <span class="muted">{t('productsNoun', { n: summary[item.key] })}</span>
    </button>
  {/each}
  <a class="stat poll" href="{resolve('/hosts')}?poll=problem">
    <span class="label"><span class="dot"></span>{t('pollProblems')}</span>
    <span class="n">{summary.pollProblems}</span>
    <span class="muted">{t('hostsNoun', { n: summary.pollProblems })}</span>
  </a>
</div>

<div class="layout">
  <div class="grid">
    {#each shown as aggregate (aggregate.productId)}
      <FleetTile
        {aggregate}
        product={productCache.products[aggregate.productId]}
        name={nameOf(aggregate.productId)}
        category={categoryOf(aggregate.productId)}
        selected={selected?.productId === aggregate.productId}
        onselect={() => (selectedId = aggregate.productId)}
      />
    {/each}
  </div>
  {#if selected}
    <div class="right">
      <FleetPanel
        aggregate={selected}
        product={productCache.products[selected.productId]}
        name={nameOf(selected.productId)}
        category={categoryOf(selected.productId)}
        chipLabel={chipLabel(selected.productId)}
        {ontoast}
      />
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
  .stat:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .stat:active {
    background: var(--surface-active);
  }
  .stat[aria-pressed='true'] {
    border-color: var(--selected);
    box-shadow: 0 0 0 1px var(--selected);
  }
  .stat.poll {
    border-style: dashed;
    border-color: var(--stale-border);
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
  @media (max-width: 1100px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .right {
      position: static;
      max-height: none;
    }
    .summary {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    }
  }
</style>
