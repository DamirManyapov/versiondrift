<script lang="ts">
  // A product over the fleet (docs/specs/fleet-ui.md §5.A): hosts by status, lines with their range and latest.
  import type { ProductAggregate } from '@versiondrift/core';
  import type { FeedProduct } from '@versiondrift/schema';
  import type { FleetHostView } from '$lib/fleet/model';
  import { lineViews } from '$lib/fleet/lines';
  import { segmentLabel, summaryText } from '$lib/fleet/labels';
  import { categoryLabel } from '$lib/i18n';
  import { i18n } from '$lib/i18n/context';
  import DistributionBar from './DistributionBar.svelte';
  import FleetChip from './FleetChip.svelte';

  let {
    aggregate,
    product,
    name,
    category,
    selected,
    onselect,
  }: {
    aggregate: ProductAggregate<FleetHostView>;
    product: FeedProduct | undefined;
    name: string;
    category: string;
    selected: boolean;
    onselect: () => void;
  } = $props();
  const { t } = $derived(i18n());

  const maxCvss = $derived(
    Math.max(0, ...aggregate.entries.map((e) => (e.key === 'critical' ? (e.instance.cvss ?? 0) : 0))),
  );
  const chipLabel = $derived(
    aggregate.status === 'critical'
      ? maxCvss > 0
        ? `CVSS ${maxCvss.toFixed(1)}`
        : t('statusCritical')
      : aggregate.status === 'eol'
        ? 'EOL'
        : aggregate.status === 'update'
          ? t('statusUpdate')
          : aggregate.status === 'ok'
            ? t('statusOk')
            : aggregate.status === 'stale'
              ? t('chipNoConnection')
              : t('chipUnknown'),
  );
  const subtitle = $derived(
    [
      categoryLabel(t, category),
      t('hosts', { n: aggregate.hosts }),
      ...(['critical', 'update', 'eol'] as const)
        .filter((k) => aggregate.counts[k] > 0)
        .map((k) => segmentLabel(t, k, aggregate.counts[k])),
    ].join(' · '),
  );
  const lines = $derived(lineViews(t, aggregate, product).slice(0, 3));
  const cves = $derived(
    Math.max(0, ...aggregate.entries.map((e) => (e.key === 'critical' ? e.instance.advisories : 0))),
  );
  const notPolled = $derived(aggregate.entries.filter((e) => e.key === 'stale').map((e) => e.host));
</script>

<button
  type="button"
  class="tile {aggregate.status}"
  aria-pressed={selected}
  onclick={onselect}
  data-fleet-tile={aggregate.productId}
>
  <span class="head">
    <span class="title">
      <span class="name">{name}</span>
      <span class="sub">{subtitle}</span>
    </span>
    <FleetChip status={aggregate.status} label={chipLabel} />
  </span>
  <DistributionBar counts={aggregate.counts} label={summaryText(t, aggregate.counts)} />
  <span class="legend">
    {#each ['critical', 'eol', 'update', 'unknown', 'ok', 'stale'] as const as key (key)}
      {#if aggregate.counts[key] > 0}<span class={key}>{segmentLabel(t, key, aggregate.counts[key])}</span
        >{/if}
    {/each}
  </span>
  {#if lines.length > 0}
    <span class="lines">
      {#each lines as line (line.track ?? line.label)}
        <span class="line">
          <span class="label">{line.label}</span>
          <span class="range mono {line.status}">{line.text}</span>
          <span class="count mono">×{line.count}</span>
        </span>
      {/each}
    </span>
  {/if}
  {#if cves > 0 || notPolled.length > 0}
    <span class="foot">
      {#if cves > 0}<span>{t('tileCves', { n: cves })}</span>{/if}
      {#if notPolled.length === 1}<span>{t('tileNotPolled', { host: notPolled[0]!.record.name })}</span>
      {:else if notPolled.length > 1}<span>{t('tileNotPolledMany', { n: notPolled.length })}</span>{/if}
    </span>
  {/if}
</button>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    text-align: left;
    padding: 18px 20px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition:
      background-color 0.12s,
      border-color 0.12s,
      box-shadow 0.12s;
  }
  .tile:hover {
    background: var(--surface-hover);
  }
  .tile:active {
    background: var(--surface-active);
  }
  .tile.critical {
    border-color: var(--critical-border);
  }
  .tile.eol {
    border-color: var(--eol-border);
  }
  .tile.update {
    border-color: var(--update-border);
  }
  .tile.ok {
    border-color: var(--ok-border);
  }
  /* Selected (the card the panel shows) is its own look and stays when focus leaves; the focus ring sits outside. */
  .tile[aria-pressed='true'] {
    border-color: var(--selected);
    box-shadow: 0 0 0 1px var(--selected);
    background: var(--selected-bg);
  }
  .tile:focus-visible {
    outline-offset: 3px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    font-size: 17px;
  }
  .sub {
    color: var(--text-muted);
    font-size: 13px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 13px;
    color: var(--text-soft);
  }
  .legend .critical {
    color: var(--critical);
  }
  .legend .update {
    color: var(--update);
  }
  .legend .ok {
    color: var(--ok);
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .line {
    display: grid;
    grid-template-columns: minmax(0, 9em) minmax(0, 1fr) auto;
    gap: 10px;
    font-size: 13px;
    align-items: baseline;
  }
  .label {
    color: var(--text-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12.5px;
  }
  .range {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .range.critical {
    color: var(--critical);
  }
  .range.update {
    color: var(--update);
  }
  .range.ok {
    color: var(--ok);
  }
  .count {
    color: var(--text-muted);
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12.5px;
    color: var(--text-muted);
  }
</style>
