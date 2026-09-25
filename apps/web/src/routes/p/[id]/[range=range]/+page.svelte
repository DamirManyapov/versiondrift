<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Meta from '$lib/components/Meta.svelte';
  import TypeChip from '$lib/components/TypeChip.svelte';
  import { formatDate } from '$lib/format';
  import { i18n } from '$lib/i18n/context';
  import { jsonLdScript, type Tagged } from '$lib/seo/pages';
  import type { ItemType } from '@versiondrift/schema';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const { t, locale } = $derived(i18n());
  const view = $derived(data.view);
  const from = $derived(view.from.version);
  const to = $derived(view.to.version);
  const id = $derived(data.id);
  const TYPES: ItemType[] = ['security', 'breaking', 'deprecated', 'feature', 'fix'];

  const counts = $derived({
    releases: t('countReleases', { n: view.releases.length }),
    breaking: t('countBreaking', { n: view.counts.breaking }),
    security: t('countSecurity', { n: view.counts.security }),
    fixed: t('countFixedAdvisories', { n: view.fixedAdvisories.length }),
  });

  const structured = $derived(
    jsonLdScript({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: data.name,
          softwareVersion: to,
          applicationCategory: data.entry.category,
          url: new URL(resolve('/p/[id]', { id }), page.url.origin).href,
        },
        {
          '@type': 'ItemList',
          name: t('compareHeading', { name: data.name, from, to }),
          itemListElement: view.releases.map((r, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: `${data.name} ${r.version}`,
            ...(r.url && { url: r.url }),
          })),
        },
      ],
    }),
  );
</script>

<Meta
  title="{t('compareMetaTitle', { name: data.name, from, to, ...counts })} · VersionDrift"
  description={t('compareDescription', { name: data.name, from, to, ...counts })}
/>
<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON-LD, escaped by jsonLd() -->
  {@html structured}
</svelte:head>

{#snippet tagged(list: Tagged[])}
  {#if list.length === 0}
    <p class="muted">{t('compareNone')}</p>
  {:else}
    <ul class="items">
      {#each list as { version, item }, i (i)}
        <li>
          <TypeChip type={item.type} />
          <span>{item.text} <span class="mono muted small">{t('inVersion', { version })}</span></span>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<article class="page">
  <nav aria-label={t('breadcrumb')} class="muted">
    <a href={resolve('/p/[id]', { id })}>{data.name}</a> / <span class="mono">{from} → {to}</span>
  </nav>
  <header>
    <h1>{t('compareHeading', { name: data.name, from, to })}</h1>
    <p class="summary">{counts.releases} · {counts.breaking} · {counts.security} · {counts.fixed}</p>
    <div class="chips">
      {#each TYPES as type (type)}
        <span class="count"><span class="n">{view.counts[type]}</span><TypeChip {type} /></span>
      {/each}
    </div>
    <p class="links">
      <a href={resolve('/p/[id]/v/[version]', { id, version: from })}>{t('isAffected', { version: from })}</a>
      {#if data.latest && data.latest !== to}
        ·
        <a href={resolve('/p/[id]/[range=range]', { id, range: `${from}...${data.latest}` })}
          >{t('compareWithLatest', { version: data.latest })}</a
        >
      {/if}
    </p>
  </header>

  {#if view.fixedAdvisories.length > 0}
    <section>
      <h2>{t('compareFixed')}</h2>
      <ul class="items">
        {#each view.fixedAdvisories as adv (adv.id)}
          <li>
            <span class="mono score">{adv.cvss?.score.toFixed(1) ?? adv.severity}</span>
            <span class="col">
              <span
                ><a class="mono" href={adv.url} target="_blank" rel="noreferrer">{adv.id}</a
                >{#if adv.kev}<strong class="kev">KEV</strong>{/if}</span
              >
              <span>{adv.title}</span>
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section>
    <h2>{t('compareBreaking')}</h2>
    {@render tagged(view.breaking)}
  </section>
  <section>
    <h2>{t('compareSecurity')}</h2>
    {@render tagged(view.security)}
  </section>
  {#if view.deprecated.length > 0}
    <section>
      <h2>{t('compareDeprecated')}</h2>
      {@render tagged(view.deprecated)}
    </section>
  {/if}

  <section>
    <h2>{t('compareAll')}</h2>
    {#each view.releases as r (r.sortKey)}
      <div class="release">
        <div class="line">
          <a class="mono ver" href={resolve('/p/[id]/v/[version]', { id, version: r.version })}>{r.version}</a
          >
          <span class="muted">{formatDate(r.date ?? r.firstSeenAt, locale)}</span>
          {#if r.url}<a class="muted small" href={r.url} target="_blank" rel="noreferrer"
              >{t('releaseNotes')} ↗</a
            >{/if}
        </div>
        {#each r.items as item, i (i)}
          <div class="item"><TypeChip type={item.type} /><span>{item.text}</span></div>
        {/each}
        {#if r.moreItems}<span class="muted small">{t('moreInNotes', { n: r.moreItems })}</span>{/if}
      </div>
    {/each}
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
    flex-direction: column;
    gap: 10px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
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
  .small {
    font-size: 12px;
  }
  .summary,
  .links {
    margin: 0;
  }
  .chips {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }
  .count {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .n {
    font-weight: 600;
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .items li,
  .item {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    align-items: baseline;
    font-size: 14px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .score {
    font-weight: 600;
    min-width: 36px;
  }
  .kev {
    margin-left: 8px;
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
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .ver {
    font-weight: 600;
  }
</style>
