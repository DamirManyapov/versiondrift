<script lang="ts">
  import Meta from '$lib/components/Meta.svelte';
  import { onMount } from 'svelte';
  import type { Catalog } from '@versiondrift/schema';
  import { searchCatalog } from '$lib/catalog';
  import { REPO_URL } from '$lib/config';
  import { feed } from '$lib/feed/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());
  let catalog = $state<Catalog | undefined>();
  let error = $state<string | undefined>();
  let query = $state('');
  let category = $state<string | undefined>();

  onMount(() => {
    inventory.init();
    feed.client.catalog().then(
      (c) => (catalog = c),
      (e: unknown) => (error = (e as Error).message),
    );
  });

  const products = $derived(catalog?.products ?? []);
  const categories = $derived([...new Set(products.map((p) => p.category))].sort());
  const results = $derived(searchCatalog(products, query, category));
  const onBoard = $derived(new Set(inventory.demo ? [] : inventory.data.items.map((i) => i.p)));
</script>

<Meta title="{t('catalogTitle')} · VersionDrift" />

<div class="catalog">
  <h1>{t('catalogTitle')}</h1>
  {#if error}
    <p role="alert" class="error">{t('feedError', { message: error })}</p>
  {:else if !catalog}
    <p class="muted">{t('loading')}</p>
  {:else}
    <p class="muted">{t('catalogIntro', { n: products.length })}</p>
    <input
      type="search"
      bind:value={query}
      placeholder={t('catalogSearch')}
      aria-label={t('catalogSearch')}
    />
    <div class="chips">
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
    </div>
    <ul>
      {#each results as p (p.id)}
        <li>
          <span class="initial" aria-hidden="true">{p.name.slice(0, 1)}</span>
          <span class="info">
            <span class="name">{p.name}</span>
            <span class="muted"
              >{p.category}{p.vendor ? ` · ${p.vendor}` : ''}{p.description
                ? ` — ${p.description}`
                : ''}</span
            >
          </span>
          {#if onBoard.has(p.id)}
            <span class="added">✓ {t('added')}</span>
          {:else}
            <button
              class="add"
              onclick={() => {
                if (inventory.demo) inventory.startOwn();
                inventory.add(p.id);
              }}>{t('add')}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
    {#if results.length === 0}<p class="muted">{t('noMatches')}</p>{/if}
    <a href="{REPO_URL}/blob/main/docs/10-contributing-modules.md" target="_blank" rel="noreferrer"
      >{t('missingProduct')}</a
    >
  {/if}
</div>

<style>
  .catalog {
    max-width: 880px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-size: 28px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  .error {
    color: var(--critical);
  }
  input {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .chip {
    height: 32px;
    padding: 0 12px;
    border-radius: 16px;
    font-size: 13px;
    border: 1px solid var(--border-strong);
  }
  .chip[aria-pressed='true'] {
    background: var(--text);
    color: var(--bg);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .initial {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--surface-3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    flex-shrink: 0;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-grow: 1;
    min-width: 0;
  }
  .name {
    font-weight: 600;
  }
  .add {
    padding: 8px 14px;
    border-radius: 8px;
    background: var(--text);
    color: var(--bg);
    font-weight: 600;
    font-size: 14px;
  }
  .added {
    color: var(--ok);
    font-size: 14px;
    font-weight: 600;
  }
</style>
