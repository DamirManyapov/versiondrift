<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import Board from '$lib/components/Board.svelte';
  import Meta from '$lib/components/Meta.svelte';
  import SharePanel from '$lib/components/SharePanel.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());

  let toast = $state<{ message: string; undo?: () => void } | undefined>();
  let sharing = $state(false);

  onMount(() => inventory.init());

  const showToast = (message: string, undo?: () => void) => (toast = { message, ...(undo && { undo }) });
</script>

<Meta title="VersionDrift" description={t('appTagline')} />

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
{:else if inventory.data.items.length === 0}
  <section class="empty">
    <h2>{t('emptyBoardTitle')}</h2>
    <p>{t('emptyBoardText')}</p>
    <a class="cta" href={resolve('/catalog')}>{t('browseCatalog')}</a>
  </section>
{:else}
  {#if sharing}
    <SharePanel items={inventory.data.items} onclose={() => (sharing = false)} ontoast={showToast} />
  {/if}
  {#snippet share()}
    <button class="chip" aria-expanded={sharing} onclick={() => (sharing = !sharing)}
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
  .cta {
    padding: 12px 18px;
    border-radius: 10px;
    background: var(--text);
    color: var(--bg);
    font-weight: 600;
    text-decoration: none;
  }
  .chip {
    height: 34px;
    padding: 0 14px;
    border-radius: 17px;
    font-size: 13px;
    border: 1px solid var(--border-strong);
    color: var(--text-soft);
  }
  .chip[aria-expanded='true'] {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
</style>
