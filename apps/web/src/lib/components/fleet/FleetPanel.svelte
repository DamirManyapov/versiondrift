<script lang="ts">
  // One product over the fleet (docs/specs/fleet-ui.md §5.A): notes, then the hosts grouped by line and version,
  // each group with its hosts, what changed up to the latest, and a copy of the host names for a ticket.
  import { copyText } from '$lib/clipboard';
  import { versionBreakdown, type ProductAggregate } from '@versiondrift/core';
  import type { FeedProduct } from '@versiondrift/schema';
  import { resolve } from '$app/paths';
  import type { FleetHostView } from '$lib/fleet/model';
  import { instanceLabel, pollLabel } from '$lib/fleet/labels';
  import { categoryLabel } from '$lib/i18n';
  import { i18n } from '$lib/i18n/context';
  import { trackName } from '$lib/tracks';
  import FleetChip from './FleetChip.svelte';

  let {
    aggregate,
    product,
    name,
    category,
    chipLabel,
    onclose,
    ontoast,
  }: {
    aggregate: ProductAggregate<FleetHostView>;
    product: FeedProduct | undefined;
    name: string;
    category: string;
    chipLabel: string;
    onclose?: (() => void) | undefined;
    ontoast: (message: string) => void;
  } = $props();
  const { t } = $derived(i18n());
  const SHOWN = 3;

  const groups = $derived(
    versionBreakdown(
      aggregate,
      (product?.tracks ?? []).map((tr) => tr.id),
    ),
  );
  const stale = $derived(aggregate.counts.stale);
  const lineCount = $derived(new Set(aggregate.entries.map((e) => e.instance.track)).size);
  let expanded = $state<Record<string, boolean>>({});

  const lineLabel = (track: string | null) => {
    const found = product?.tracks.find((tr) => tr.id === track);
    return found ? trackName(found) : track;
  };

  // The button itself says it worked for two seconds, the toast says how many (UI audit P1-3).
  let copied = $state<string | undefined>();
  async function copyHosts(key: string, names: string[]) {
    try {
      await copyText(names.join('\n'));
      copied = key;
      setTimeout(() => (copied = copied === key ? undefined : copied), 2000);
      ontoast(t('copiedHosts', { n: names.length }));
    } catch {
      ontoast(names.join(', '));
    }
  }
</script>

<section class="panel" aria-labelledby="fleet-panel-title">
  <header>
    <div class="grow">
      <h2 id="fleet-panel-title">
        <a class="plain" href={resolve('/p/[id]', { id: aggregate.productId })}>{name}</a>
      </h2>
      <p class="muted">
        {t('panelHosts', { category: categoryLabel(t, category), hosts: t('hosts', { n: aggregate.hosts }) })}
      </p>
    </div>
    <FleetChip status={aggregate.status} label={chipLabel} size="md" />
    {#if onclose}<button class="btn btn-sm btn-ghost btn-icon" onclick={onclose} aria-label={t('closePanel')}
        >✕</button
      >{/if}
  </header>

  {#if stale > 0 || lineCount > 1}
    <ul class="notes">
      {#if lineCount > 1}<li>{t('noteLatestPerLine')}</li>{/if}
      {#if stale > 0}<li>{t('noteLastKnown', { n: stale })}</li>{/if}
    </ul>
  {/if}

  <h3>{t('breakdownTitle')} <span class="muted small">{t('breakdownHint')}</span></h3>
  <div class="groups">
    {#each groups as group (`${group.track}/${group.version}`)}
      {@const key = `${group.track}/${group.version}`}
      {@const shown = expanded[key] ? group.entries : group.entries.slice(0, SHOWN)}
      <article class="group">
        <div class="ghead">
          <span class="version mono">{group.version}</span>
          {#if group.track}<span class="muted small"
              >{t('lineOf', { line: lineLabel(group.track) ?? '' })}</span
            >{/if}
          <span class="muted small mono">×{group.entries.length}</span>
          <span class="grow"></span>
          <FleetChip status={group.status} label={instanceLabel(t, group.instance)} />
        </div>
        <ul class="hosts">
          {#each shown as entry (entry.host.id)}
            <li>
              <a
                class="host mono"
                class:stale={entry.key === 'stale'}
                href={resolve('/hosts/[id]', { id: entry.host.id })}
                >{entry.host.record.name}{#if entry.key === 'stale'}
                  <span class="why">· {pollLabel(t, entry.host.poll.state).toLowerCase()}</span>{/if}<span
                  class="go"
                  aria-hidden="true">→</span
                ></a
              >
            </li>
          {/each}
          {#if group.entries.length > SHOWN && !expanded[key]}
            <li>
              <button class="btn btn-sm btn-ghost" onclick={() => (expanded[key] = true)}
                >{t('showAllHosts', { n: group.entries.length })}</button
              >
            </li>
          {/if}
        </ul>
        <div class="actions">
          {#if group.latest && group.latest !== group.version && group.status !== 'eol'}
            <a
              class="btn btn-sm"
              href={resolve('/p/[id]/[range=range]', {
                id: aggregate.productId,
                range: `${group.version}...${group.latest}`,
              })}>{t('changesTo', { version: group.latest })} →</a
            >
          {/if}
          <button
            class="btn btn-sm"
            onclick={() =>
              void copyHosts(
                key,
                group.entries.map((e) => e.host.record.name),
              )}>{copied === key ? `✓ ${t('copiedShort')}` : `⧉ ${t('copyHosts')}`}</button
          >
        </div>
      </article>
    {/each}
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 24px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface);
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 24px;
  }
  h3 {
    margin: 6px 0 0;
    font-size: 15px;
  }
  .plain {
    color: inherit;
    text-decoration: none;
  }
  .plain:hover {
    text-decoration: underline;
  }
  p {
    margin: 4px 0 0;
  }
  .muted {
    color: var(--text-muted);
  }
  .small {
    font-size: 13px;
    font-weight: 400;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .notes {
    margin: 0;
    padding: 12px 14px 12px 30px;
    border-radius: 10px;
    background: var(--surface-2);
    font-size: 13px;
    color: var(--text-soft);
    display: grid;
    gap: 4px;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .ghead {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .version {
    font-size: 17px;
    font-weight: 600;
  }
  .hosts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .host {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: var(--control-h-sm);
    padding: 0 10px;
    border-radius: var(--control-radius-sm);
    border: 1px solid var(--border-strong);
    color: var(--text);
    text-decoration: none;
    font-size: 13px;
    transition:
      background-color 0.12s,
      border-color 0.12s;
  }
  .host:hover {
    border-color: var(--link);
    background: var(--surface-hover);
    color: var(--text);
  }
  .host:active {
    background: var(--surface-active);
  }
  .host.stale {
    border-style: dashed;
    color: var(--text-muted);
  }
  .why {
    font-family: var(--font-sans);
    font-size: 12px;
  }
  .go {
    color: var(--text-muted);
    font-family: var(--font-sans);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
