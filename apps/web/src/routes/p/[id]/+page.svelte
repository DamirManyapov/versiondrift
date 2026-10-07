<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { ItemType } from '@versiondrift/schema';
  import Meta from '$lib/components/Meta.svelte';
  import TypeChip from '$lib/components/TypeChip.svelte';
  import { REPO_URL } from '$lib/config';
  import { formatDate } from '$lib/format';
  import { categoryLabel } from '$lib/i18n';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';
  import { jsonLdScript } from '$lib/seo/pages';
  import { trackName } from '$lib/tracks';
  import { inTrack } from '@versiondrift/core';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const { t, locale } = $derived(i18n());
  const product = $derived(data.product);
  const stable = $derived(product.releases.filter((r) => !r.prerelease));
  const latest = $derived(stable[0]);
  const perTrack = $derived(
    product.tracks.map((track) => ({
      track,
      release: product.releases.find((r) => inTrack(product, track.id, r)),
    })),
  );
  const onBoard = $derived(
    inventory.loaded && !inventory.demo && inventory.data.items.some((i) => i.p === product.id),
  );

  onMount(() => inventory.init());

  const structured = $derived(
    jsonLdScript({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: product.name,
      applicationCategory: data.entry.category,
      ...(latest && { softwareVersion: latest.version }),
      ...(latest?.date && { datePublished: latest.date.slice(0, 10) }),
      url: `${page.url.origin}${page.url.pathname}`,
    }),
  );

  function countTypes(items: { type: ItemType }[]): [ItemType, number][] {
    const counts: Partial<Record<ItemType, number>> = {};
    for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
    return Object.entries(counts) as [ItemType, number][];
  }
</script>

<Meta
  title="{t('productPageTitle', { name: product.name })} · VersionDrift"
  description={t('productPageDescription', { name: product.name, latest: latest?.version ?? '' })}
/>
<svelte:head>
  <link
    rel="alternate"
    type="application/rss+xml"
    title={t('rssProductTitle', { name: product.name })}
    href={resolve('/rss/p/[id].xml', { id: product.id })}
  />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON-LD, escaped by jsonLdScript() -->
  {@html structured}
</svelte:head>

<article class="page">
  <header>
    <div class="grow">
      <h1>{product.name}</h1>
      <p class="muted">
        {categoryLabel(t, data.entry.category)} ·
        <a class="mono" href="{REPO_URL}/blob/main/products/{product.id}.yaml">products/{product.id}.yaml</a>
        · <a href={resolve('/rss/p/[id].xml', { id: product.id })}>{t('rssFeed')}</a>
      </p>
    </div>
    {#if latest}
      <div class="latest">
        <span class="muted">{t('latest')}</span>
        <span class="mono big">{latest.version}</span>
        <span class="muted">{formatDate(latest.date ?? latest.firstSeenAt, locale)}</span>
      </div>
    {/if}
    {#if onBoard}
      <span class="on">✓ {t('onYourBoard')}</span>
    {:else}
      <button
        type="button"
        class="btn btn-primary"
        onclick={() => {
          if (inventory.demo) inventory.startOwn();
          inventory.add(product.id);
        }}>{t('addToBoard')}</button
      >
    {/if}
  </header>

  {#if perTrack.length > 0}
    <section>
      <h2>{t('latestPerTrack')}</h2>
      <table>
        <thead><tr><th>{t('track')}</th><th>{t('latest')}</th><th>{t('released')}</th></tr></thead>
        <tbody>
          {#each perTrack as { track, release } (track.id)}
            <tr>
              <td class="mono">{trackName(track)}</td>
              <td class="mono">{release?.version ?? '—'}</td>
              <td>{release ? formatDate(release.date ?? release.firstSeenAt, locale) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if product.branches.length > 0}
    <section>
      <h2>{t('lifecycle')}</h2>
      <table>
        <thead
          ><tr><th>{t('branch')}</th><th>{t('latest')}</th><th>{t('released')}</th><th>{t('eolDate')}</th></tr
          ></thead
        >
        <tbody>
          {#each product.branches as b (b.id)}
            <tr class:ended={b.eol}>
              <td class="mono">{b.id}{b.codename ? ` (${b.codename})` : ''}{b.lts ? ' LTS' : ''}</td>
              <td class="mono">{b.latest ?? '—'}</td>
              <td>{b.releaseDate ? formatDate(b.releaseDate, locale) : '—'}</td>
              <td
                >{b.eolDate ? formatDate(b.eolDate, locale) : '—'} · {b.eol
                  ? t('ended')
                  : t('maintained')}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  <section>
    <h2>{t('allReleases')}</h2>
    {#each stable.slice(0, 15) as r (r.sortKey)}
      <div class="release">
        <div class="line">
          <a class="mono ver" href={resolve('/p/[id]/v/[version]', { id: product.id, version: r.version })}
            >{r.version}</a
          >
          <span class="muted">{formatDate(r.date ?? r.firstSeenAt, locale)}</span>
          {#if latest && r.version !== latest.version}
            <a
              class="muted"
              href={resolve('/p/[id]/[range=range]', {
                id: product.id,
                range: `${r.version}...${latest.version}`,
              })}>→ {latest.version}</a
            >
          {/if}
          {#if r.url}<a class="muted" href={r.url} target="_blank" rel="noreferrer">{t('releaseNotes')} ↗</a
            >{/if}
          <span class="grow"></span>
          {#each countTypes(r.items).filter(([type]) => type !== 'other') as [type, n] (type)}
            <span class="count">{n}</span><TypeChip {type} />
          {/each}
        </div>
        {#each r.items
          .filter((i) => i.type === 'security' || i.type === 'breaking')
          .slice(0, 3) as item, i (i)}
          <div class="item"><TypeChip type={item.type} /><span>{item.text}</span></div>
        {/each}
      </div>
    {/each}
  </section>

  <section>
    <h2>{t('advisories')}</h2>
    {#if product.advisories.length === 0}
      <p class="muted">{data.entry.hasSecuritySource ? t('noAdvisories') : t('noVulnSource')}</p>
    {:else}
      {#each product.advisories.slice(0, 20) as adv (adv.id)}
        <div class="item">
          <span class="mono">{adv.cvss?.score.toFixed(1) ?? adv.severity}</span>
          <a class="mono" href={adv.url} target="_blank" rel="noreferrer">{adv.id}</a>
          <span>{adv.title}</span>
        </div>
      {/each}
    {/if}
  </section>

  <section>
    <h2>{t('sources')}</h2>
    <ul>
      {#each product.sources as source (source.url)}
        <li>
          <span class="mono muted">{source.type}</span>
          <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
        </li>
      {/each}
    </ul>
  </section>
</article>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
  }
  .grow {
    flex-grow: 1;
  }
  h1 {
    margin: 0;
    font-size: 32px;
    letter-spacing: -0.01em;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 18px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
    margin: 0;
  }
  .latest {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .big {
    font-size: 24px;
    font-weight: 600;
  }
  .on {
    color: var(--ok);
    font-weight: 600;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 14px;
  }
  th,
  td {
    text-align: left;
    padding: 8px 12px 8px 0;
    border-bottom: 1px solid var(--border);
  }
  th {
    color: var(--text-muted);
    font-weight: 500;
  }
  tr.ended {
    color: var(--text-muted);
  }
  .release {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .ver {
    font-weight: 600;
  }
  .count {
    font-size: 13px;
    color: var(--text-muted);
  }
  .item {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 14px;
  }
  ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    word-break: break-all;
  }
</style>
