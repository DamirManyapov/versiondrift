<script lang="ts">
  // Summary strip, filters, tile grid and detail panel (docs/06 "Board") for the user's board and for shared ones.
  import { tick, untrack, type Snippet } from 'svelte';
  import { productCache } from '$lib/board/products.svelte';
  import { buildRows, filterRows, summarize, SUMMARY_STATUSES, type SummaryStatus } from '$lib/board/rows';
  import { feed } from '$lib/feed/state.svelte';
  import { categoryLabel } from '$lib/i18n';
  import { i18n } from '$lib/i18n/context';
  import type { InventoryItem, InventorySettings } from '$lib/inventory/model';
  import DetailPanel from './DetailPanel.svelte';
  import Tile from './Tile.svelte';

  let {
    items,
    settings,
    readonly = false,
    summary = true,
    onhideok,
    ontoast,
    actions,
  }: {
    items: InventoryItem[];
    settings: InventorySettings;
    /** A shared board: no edits, the detail panel only shows. */
    readonly?: boolean;
    /** The status strip on top; off where the page already has one (the fleet board). */
    summary?: boolean;
    onhideok: (value: boolean) => void;
    ontoast: (message: string, undo?: () => void) => void;
    /** Extra controls at the end of the filter row (e.g. "Share"). */
    actions?: Snippet;
  } = $props();

  const { t } = $derived(i18n());

  let status = $state<SummaryStatus | undefined>();
  let category = $state<string | undefined>();
  let query = $state('');
  let selectedId = $state<string | undefined>();
  let overlay = $state(false);

  $effect(() => {
    const ids = items.map((i) => i.p);
    // Track the index and the items only, not the product cache that ensure() fills.
    if (feed.index) untrack(() => void productCache.ensure(ids));
  });

  const rows = $derived(buildRows(items, feed.index, productCache.products, settings));
  const visible = $derived(filterRows(rows, { status, category, query, hideOk: settings.hideOk }));
  const counts = $derived(summarize(rows));
  const categories = $derived(
    [...new Set(rows.map((r) => r.category))].sort((a, b) =>
      categoryLabel(t, a).localeCompare(categoryLabel(t, b)),
    ),
  );
  const selected = $derived(rows.find((r) => r.id === selectedId) ?? visible[0]);
  const filtered = $derived(status !== undefined || category !== undefined || query !== '');

  const SUMMARY_KEYS = {
    critical: 'summaryCritical',
    eol: 'summaryEol',
    update: 'summaryUpdate',
    ok: 'summaryOk',
  } as const;

  async function select(id: string) {
    selectedId = id;
    overlay = true;
    // On narrow screens the panel covers the board: move focus into it (Escape returns).
    if (window.matchMedia('(max-width: 1100px)').matches) {
      await tick();
      document.querySelector<HTMLElement>('#detail-title a')?.focus();
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && overlay && window.matchMedia('(max-width: 1100px)').matches) {
      overlay = false;
      document.querySelector<HTMLElement>(`[data-tile][aria-pressed='true']`)?.focus();
    }
  }

  /** Arrow keys move focus between tiles (docs/06: keyboard). */
  function onGridKey(event: KeyboardEvent) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const tiles = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-tile]')];
    const current = tiles.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    const top = tiles[0]?.offsetTop ?? 0;
    const columns = Math.max(1, tiles.filter((tile) => tile.offsetTop === top).length);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key] ?? 0;
    const next = tiles[current + step];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="board">
  <div class="left">
    {#if summary}<div class="summary">
        {#each SUMMARY_STATUSES as key (key)}
          <button
            class="stat {key}"
            aria-pressed={status === key}
            onclick={() => (status = status === key ? undefined : key)}
          >
            <span class="dot" aria-hidden="true"></span>
            <span class="col">
              <span class="n">{counts[key]}</span>
              <span class="muted">{t(SUMMARY_KEYS[key])}</span>
            </span>
          </button>
        {/each}
      </div>{/if}

    <div class="filters">
      <button class="chip" aria-pressed={category === undefined} onclick={() => (category = undefined)}
        >{t('filterAll')}</button
      >
      {#each categories as c (c)}
        <button
          class="chip"
          aria-pressed={category === c}
          onclick={() => (category = category === c ? undefined : c)}>{categoryLabel(t, c)}</button
        >
      {/each}
      <span class="grow"></span>
      <input
        type="search"
        placeholder={t('searchPlaceholder')}
        bind:value={query}
        aria-label={t('searchPlaceholder')}
      />
      <label class="toggle">
        <input
          type="checkbox"
          checked={settings.hideOk}
          onchange={(e) => onhideok(e.currentTarget.checked)}
        />
        {t('hideOk')}
      </label>
      {#if filtered}
        <button
          class="link"
          onclick={() => {
            status = undefined;
            category = undefined;
            query = '';
          }}>{t('clearFilter')}</button
        >
      {/if}
      {@render actions?.()}
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="grid" onkeydown={onGridKey}>
      {#each visible as row (row.id)}
        <Tile {row} selected={row.id === selected?.id} onselect={() => select(row.id)} />
      {/each}
    </div>
    {#if visible.length === 0}<p class="muted center">{t('nothingMatches')}</p>{/if}
  </div>

  {#if selected}
    <div class="right" class:overlay>
      <DetailPanel row={selected} {readonly} onclose={() => (overlay = false)} {ontoast} />
    </div>
  {/if}
</div>

<style>
  .board {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(380px, 2fr);
    gap: 24px;
    align-items: start;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .right {
    position: sticky;
    top: 16px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  .stat {
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .stat[aria-pressed='true'] {
    border-color: var(--text);
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 6px;
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
  .col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .n {
    font-size: 26px;
    font-weight: 600;
    line-height: 1;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  .center {
    text-align: center;
    padding: 48px;
  }
  .filters {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .chip {
    height: 34px;
    padding: 0 14px;
    border-radius: 17px;
    font-size: 13px;
    border: 1px solid var(--border-strong);
    color: var(--text-soft);
  }
  .chip[aria-pressed='true'] {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
  .grow {
    flex-grow: 1;
  }
  input[type='search'] {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 7px 10px;
    min-width: 180px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-soft);
  }
  .link {
    font-size: 13px;
    color: var(--link);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 16px;
  }
  @media (max-width: 1100px) {
    .board {
      grid-template-columns: minmax(0, 1fr);
    }
    .right {
      display: none;
    }
    .right.overlay {
      display: block;
      position: fixed;
      inset: 0;
      top: 0;
      max-height: none;
      z-index: 40;
      background: var(--bg);
      padding: 16px;
    }
  }
  @media (max-width: 720px) {
    .summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .right.overlay {
      padding: 0;
    }
  }
</style>
