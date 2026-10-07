<script lang="ts">
  // A shared board (S4-T1): read from the URL fragment in the browser, shown read-only until saved.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import Board from '$lib/components/Board.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import type { InventoryItem } from '$lib/inventory/model';
  import { decodeShare, mergeItems } from '$lib/inventory/share';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());

  let items = $state<InventoryItem[] | undefined>();
  let broken = $state(false);
  let hideOk = $state(false);
  let choosing = $state(false);
  let toast = $state<{ message: string; undo?: () => void } | undefined>();

  async function load() {
    try {
      items = await decodeShare(location.hash);
      broken = false;
    } catch {
      items = undefined;
      broken = true;
    }
  }

  onMount(() => {
    inventory.init();
    void load();
    const onHash = () => void load();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });

  /** The user's own board, as opposed to the demo shown on a first visit. */
  const hasOwn = $derived(!inventory.demo && inventory.data.items.length > 0);

  async function save(mode: 'replace' | 'merge') {
    if (!items) return;
    inventory.replaceItems(mode === 'merge' ? mergeItems(inventory.data.items, items) : items);
    await goto(resolve('/'));
  }
</script>

<svelte:head>
  <title>{t('sharedTitle')} · VersionDrift</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<h1 class="visually-hidden">{t('sharedTitle')}</h1>

{#if broken}
  <section class="empty">
    <h2>{t('sharedInvalid')}</h2>
    <a class="btn btn-primary" href={resolve('/')}>{t('sharedBack')}</a>
  </section>
{:else if feed.error}
  <p role="alert" class="error">{t('feedError', { message: feed.error })}</p>
{:else if !items}
  <p class="muted">{t('loading')}</p>
{:else}
  <div class="shared" role="note">
    <span class="text">{t('sharedBanner', { n: new Set(items.map((i) => i.p)).size })}</span>
    {#if choosing}
      <span class="muted">{t('sharedChoose')}</span>
      <button class="btn btn-primary" onclick={() => save('merge')}>{t('sharedMerge')}</button>
      <button class="btn" onclick={() => save('replace')}>{t('sharedReplace')}</button>
      <button class="btn btn-ghost" onclick={() => (choosing = false)}>{t('cancel')}</button>
    {:else}
      <button class="btn btn-primary" onclick={() => (hasOwn ? (choosing = true) : save('replace'))}
        >{t('sharedSave')}</button
      >
    {/if}
  </div>
  <Board
    {items}
    settings={{ ...inventory.data.settings, hideOk }}
    readonly
    onhideok={(value: boolean) => (hideOk = value)}
    ontoast={(message: string, undo?: () => void) => (toast = { message, ...(undo && { undo }) })}
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
  .error {
    color: var(--critical);
  }
  .shared {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 16px;
    margin-bottom: 16px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px dashed var(--border-strong);
  }
  .text {
    flex: 1 1 320px;
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
</style>
