<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import { formatDate } from '$lib/format';
  import { i18n } from '$lib/i18n/context';
  import { jsonLdScript } from '$lib/seo/pages';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const { t, locale } = $derived(i18n());
  const id = $derived(data.id);
  const version = $derived(data.release.version);
  const s = $derived(data.status);
  const canonical = $derived(`${page.url.origin}${page.url.pathname}`);
  const eol = $derived(s.status === 'eol' || (s.status === 'critical' && s.branch?.eol === true));

  const verdict = $derived(
    [
      s.affecting.length > 0 ? t('verdictShortVulns', { n: s.affecting.length }) : t('verdictShortNone'),
      ...(eol ? [t('verdictShortEol')] : []),
    ].join(', '),
  );

  const structured = $derived(
    jsonLdScript({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: data.name,
      softwareVersion: version,
      applicationCategory: data.entry.category,
      ...(data.release.date && { datePublished: data.release.date.slice(0, 10) }),
      url: new URL(resolve('/p/[id]', { id }), page.url.origin).href,
    }),
  );
</script>

<svelte:head>
  <title>{t('versionMetaTitle', { name: data.name, version, verdict })} · VersionDrift</title>
  <meta name="description" content={t('versionDescription', { name: data.name, version })} />
  <link rel="canonical" href={canonical} />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON-LD, escaped by jsonLd() -->
  {@html structured}
</svelte:head>

<article class="page">
  <nav aria-label={t('breadcrumb')} class="muted">
    <a href={resolve('/p/[id]', { id })}>{data.name}</a> / <span class="mono">{version}</span>
  </nav>
  <header>
    <h1>{t('versionHeading', { name: data.name, version })}</h1>
    <p class="muted">
      {formatDate(data.release.date ?? data.release.firstSeenAt, locale)}
      {#if data.release.url}· <a href={data.release.url} target="_blank" rel="noreferrer"
          >{t('releaseNotes')} ↗</a
        >{/if}
    </p>
  </header>

  <section class="verdict {s.status}">
    <StatusChip status={s.status} cvss={s.maxCvss} size="md" />
    <div class="col">
      {#if s.affecting.length > 0}
        <p>
          <strong>{t('verdictVulns', { n: s.affecting.length, version })}</strong
          >{#if s.maxCvss !== undefined}{t('verdictWorst', { score: s.maxCvss.toFixed(1) })}{/if}.
        </p>
      {:else if data.entry.hasSecuritySource}
        <p>{t('verdictNone', { version })}</p>
      {:else}
        <p>{t('verdictNoSource')}</p>
      {/if}
      {#if s.branch?.eol}
        <p>
          {t('noteEol', {
            branch: s.branch.id,
            date: s.branch.eolDate ? ` (${formatDate(s.branch.eolDate, locale)})` : '',
          })}
        </p>
      {/if}
      {#if data.newerTotal > 0 && s.latest}
        <p>
          {t('verdictNewer', { n: data.newerTotal, latest: s.latest })}
          <a href={resolve('/p/[id]/[range=range]', { id, range: `${version}...${s.latest}` })}
            >{t('compareWithLatest', { version: s.latest })}</a
          >
        </p>
      {:else}
        <p>{t('verdictLatest', { version })}</p>
      {/if}
      {#if s.newestOverall}<p>{t('noteNewMajor', { version: s.newestOverall })}</p>{/if}
    </div>
  </section>

  {#if s.affecting.length > 0}
    <section>
      <h2>{t('vulnsAffecting', { version })}</h2>
      <ul class="items">
        {#each s.affecting as adv (adv.id)}
          <li>
            <span class="mono score">{adv.cvss?.score.toFixed(1) ?? adv.severity}</span>
            <div class="col">
              <a class="mono" href={adv.url} target="_blank" rel="noreferrer">{adv.id}</a>
              <span>{adv.title}</span>
              <span class="muted">
                {#if adv.kev}<strong>KEV</strong> ·{/if}
                {#if data.fixes[adv.id]}{t('fixedIn', { version: data.fixes[adv.id] ?? '' })}{/if}
              </span>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if s.newer.length > 0}
    <section>
      <h2>{t('newerReleases')}</h2>
      <table>
        <tbody>
          {#each s.newer as r (r.sortKey)}
            <tr>
              <td class="mono"
                ><a href={resolve('/p/[id]/v/[version]', { id, version: r.version })}>{r.version}</a></td
              >
              <td>{formatDate(r.date ?? r.firstSeenAt, locale)}</td>
              <td
                ><a href={resolve('/p/[id]/[range=range]', { id, range: `${version}...${r.version}` })}
                  >{version} → {r.version}</a
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
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
    gap: 6px;
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
  .verdict {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    padding: 16px 18px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .verdict p {
    margin: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .items li {
    display: flex;
    gap: 12px;
    align-items: baseline;
    font-size: 14px;
  }
  .score {
    font-weight: 600;
    min-width: 36px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 14px;
  }
  td {
    text-align: left;
    padding: 8px 12px 8px 0;
    border-bottom: 1px solid var(--border);
  }
</style>
