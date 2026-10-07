<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Board from '$lib/components/Board.svelte';
  import BoardSwitcher from '$lib/components/BoardSwitcher.svelte';
  import Landing from '$lib/components/Landing.svelte';
  import Meta from '$lib/components/Meta.svelte';
  import SharePanel from '$lib/components/SharePanel.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import FleetBoard from '$lib/components/fleet/FleetBoard.svelte';
  import HostlessProducts from '$lib/components/fleet/HostlessProducts.svelte';
  import { fleet, siteFrom } from '$lib/fleet/state.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import { productCache } from '$lib/board/products.svelte';
  import { buildRows } from '$lib/board/rows';
  import { hostlessView } from '$lib/fleet/hostless';

  const { t } = $derived(i18n());

  let toast = $state<{ message: string; undo?: () => void } | undefined>();
  let sharing = $state(false);

  onMount(() => inventory.init());

  const showToast = (message: string, undo?: () => void) => (toast = { message, ...(undo && { undo }) });

  // The fleet board has one detail panel: a fleet product, or a product without a host when one was clicked.
  const site = $derived(fleet.data ? siteFrom(page.url, fleet.data) : undefined);
  const canEdit = $derived(page.data.account?.role !== 'viewer');
  let hostlessId = $state<string | undefined>();
  const chooseHostless = (id: string) => (hostlessId = id);
  const hostlessRow = $derived.by(() => {
    if (!hostlessId || !fleet.data) return undefined;
    const { items } = hostlessView(fleet.data, site, {
      loaded: inventory.loaded,
      boardId: inventory.boardId,
      items: inventory.data.items,
    });
    return buildRows(items, feed.index, productCache.products, inventory.data.settings).find(
      (r) => r.id === hostlessId,
    );
  });
</script>

<Meta title="VersionDrift" description={t('appTagline')} />

<h1 class="visually-hidden">VersionDrift</h1>

<!-- Server-rendered for everyone (search engines see it); hidden once a saved board is known. -->
{#if page.data.mode === 'public' && (!inventory.loaded || inventory.demo)}<Landing />{/if}

{#if page.data.mode === 'selfhosted' && fleet.hasHosts && fleet.data}
  {@const data = fleet.data}
  <FleetBoard
    {data}
    {site}
    ontoast={showToast}
    other={hostlessRow ? hostlessPanel : undefined}
    onpick={() => (hostlessId = undefined)}
  >
    {#snippet below()}
      <HostlessProducts
        {data}
        {site}
        chosen={hostlessRow?.id}
        onchoose={chooseHostless}
        ontoast={showToast}
      />
    {/snippet}
  </FleetBoard>
  {#snippet hostlessPanel()}
    {#if hostlessRow}
      <DetailPanel
        row={hostlessRow}
        readonly={site === undefined || !canEdit}
        readonlyNote={!canEdit ? t('viewerReadonly') : site === undefined ? t('hostlessReadonly') : undefined}
        ontoast={showToast}
      />
    {/if}
  {/snippet}
{:else}
  {#if inventory.mode === 'selfhosted' && inventory.boards.length > 0}<BoardSwitcher />{/if}

  {#if inventory.serverError}
    <p class="banner" role="alert">{t('serverError', { message: inventory.serverError })}</p>
  {/if}

  {#if inventory.demo}
    <div class="demo" role="note">
      <span>{t('demoBanner')}</span>
      <button type="button" class="btn btn-primary" onclick={() => inventory.startOwn()}
        >{t('demoStart')}</button
      >
    </div>
  {/if}

  {#if !inventory.persistent}
    <p class="banner" role="alert">{t('storageBanner')}</p>
  {/if}

  {#if feed.error}
    <p role="alert" class="error">{t('feedError', { message: feed.error })}</p>
    {#if inventory.mode === 'selfhosted'}
      <p class="muted"><a href={resolve('/settings')}>{t('feedMissingHint')}</a></p>
    {/if}
  {:else if !inventory.loaded}
    <p class="muted">{t('loading')}</p>
  {:else if inventory.data.items.length === 0}
    <section class="empty">
      <h2>{t('emptyBoardTitle')}</h2>
      <p>{t('emptyBoardText')}</p>
      <a class="btn btn-primary" href={resolve('/catalog')}>{t('browseCatalog')}</a>
    </section>
  {:else}
    {#if sharing}
      <SharePanel items={inventory.data.items} onclose={() => (sharing = false)} ontoast={showToast} />
    {/if}
    {#snippet share()}
      <button type="button" class="chip-btn" aria-expanded={sharing} onclick={() => (sharing = !sharing)}
        >{t('shareBoard')}</button
      >
    {/snippet}
    <Board
      items={inventory.data.items}
      settings={inventory.data.settings}
      onhideok={(value: boolean) => inventory.setSettings({ hideOk: value })}
      ontoast={showToast}
      actions={share}
    />
  {/if}
{/if}

{#if toast}
  <Toast message={toast.message} undo={toast.undo} onclose={() => (toast = undefined)} />
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: 13px;
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
  .chip-btn[aria-expanded='true'] {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
</style>
