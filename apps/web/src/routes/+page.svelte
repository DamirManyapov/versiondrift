<script lang="ts">
  import { feed } from '$lib/feed/state.svelte';
  import { formatDate } from '$lib/format';
  import { i18n } from '$lib/i18n/context';

  const { t, locale } = $derived(i18n());
  const products = $derived(
    Object.entries(feed.index?.products ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name)),
  );
</script>

<svelte:head>
  <title>VersionDrift</title>
  <meta name="description" content={t('appTagline')} />
</svelte:head>

<h1 class="visually-hidden">VersionDrift</h1>

{#if feed.error}
  <p role="alert" class="error">{t('feedError', { message: feed.error })}</p>
{:else if !feed.index}
  <p class="muted">{t('loading')}</p>
{:else}
  <p class="muted">{t('products', { n: products.length })}</p>
  <ul class="grid">
    {#each products as [id, product] (id)}
      <li class="card">
        <span class="title">{product.name}</span>
        <span class="muted">{product.category}</span>
        <span class="mono">{product.latest ?? '—'}</span>
        {#if product.latestDate}<span class="muted">{formatDate(product.latestDate, locale)}</span>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  }
  .card {
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .title {
    font-size: 17px;
    font-weight: 600;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  .error {
    color: var(--critical);
  }
</style>
