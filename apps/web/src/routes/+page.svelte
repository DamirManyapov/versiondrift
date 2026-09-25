<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { productCache } from '$lib/board/products.svelte';
  import { buildRows, filterRows, summarize, SUMMARY_STATUSES, type SummaryStatus } from '$lib/board/rows';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import Tile from '$lib/components/Tile.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());

  let status = $state<SummaryStatus | undefined>();
  let category = $state<string | undefined>();
  let query = $state('');
  let selectedId = $state<string | undefined>();
  let overlay = $state(false);
  let toast = $state<{ message: string; undo?: () => void } | undefined>();

  onMount(() => inventory.init());

  $effect(() => {
    const ids = inventory.data.items.map((i) => i.p);
    // Track the index and the inventory only, not the product cache that ensure() fills.
    if (feed.index) untrack(() => void productCache.ensure(ids));
  });

  const rows = $derived(
    buildRows(inventory.data.items, feed.index, productCache.products, inventory.data.settings),
  );
  const visible = $derived(
    filterRows(rows, { status, category, query, hideOk: inventory.data.settings.hideOk }),
  );
  const counts = $derived(summarize(rows));
  const categories = $derived([...new Set(rows.map((r) => r.category))].sort());
  const selected = $derived(rows.find((r) => r.id === selectedId) ?? visible[0]);
  const filtered = $derived(status !== undefined || category !== undefined || query !== '');

  const SUMMARY_KEYS = {
    critical: 'summaryCritical',
    eol: 'summaryEol',
    update: 'summaryUpdate',
    ok: 'summaryOk',
  } as const;

  function select(id: string) {
    selectedId = id;
    overlay = true;
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

<svelte:head>
  <title>VersionDrift</title>
  <meta name="description" content={t('appTagline')} />
</svelte:head>

<h1 class="visually-hidden">VersionDrift</h1>

{#if inventory.demo}
  <div class="demo" role="note">
    <span>{t('demoBanner')}</span>
    <button class="cta" onclick={() => inventory.startOwn()}>{t('demoStart')}</button>
  </div>
{/if}

{#if !inventory.persistent}
  <p class="banner" role="alert">{t('storageBanner')}</p>
{/if}

{#if feed.error}
  <p role="alert" class="error">{t('feedError', { message: feed.error })}</p>
{:else if !inventory.loaded}
  <p class="muted">{t('loading')}</p>
{:else if rows.length === 0}
  <section class="empty">
    <h2>{t('emptyBoardTitle')}</h2>
    <p>{t('emptyBoardText')}</p>
    <a class="cta" href={resolve('/catalog')}>{t('browseCatalog')}</a>
  </section>
{:else}
  <div class="board">
    <div class="left">
      <div class="summary">
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
      </div>

      <div class="filters">
        <button class="chip" aria-pressed={category === undefined} onclick={() => (category = undefined)}
          >{t('filterAll')}</button
        >
        {#each categories as c (c)}
          <button
            class="chip"
            aria-pressed={category === c}
            onclick={() => (category = category === c ? undefined : c)}>{c}</button
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
            checked={inventory.data.settings.hideOk}
            onchange={(e) => inventory.setSettings({ hideOk: e.currentTarget.checked })}
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
        <DetailPanel
          row={selected}
          onclose={() => (overlay = false)}
          ontoast={(message: string, undo?: () => void) => (toast = { message, ...(undo && { undo }) })}
        />
      </div>
    {/if}
  </div>
{/if}

{#if toast}
  <Toast message={toast.message} undo={toast.undo} onclose={() => (toast = undefined)} />
{/if}

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
  .demo {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    padding: 12px 16px;
    margin-bottom: 16px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px dashed var(--border-strong);
  }
  .demo span {
    flex: 1 1 320px;
  }
  .banner {
    padding: 12px 16px;
    border-radius: 10px;
    background: var(--update-bg);
    border: 1px solid var(--update-border);
  }
  .error {
    color: var(--critical);
  }
  .empty {
    max-width: 560px;
    margin: 64px auto;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }
  .empty h2 {
    margin: 0;
  }
  .cta {
    padding: 12px 18px;
    border-radius: 10px;
    background: var(--text);
    color: var(--bg);
    font-weight: 600;
    text-decoration: none;
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
