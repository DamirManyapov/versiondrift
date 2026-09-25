<script lang="ts">
  import { resolve } from '$app/paths';
  import { formatUpdated } from '$lib/format';
  import { i18n } from '$lib/i18n/context';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const { t, locale } = $derived(i18n());
  const modules = $derived(Object.entries(data.health.modules));
  const failing = $derived(modules.filter(([, m]) => m.status === 'failed'));
  const okCount = $derived(modules.length - failing.length);
</script>

<svelte:head>
  <title>{t('statusPageTitle')} · VersionDrift</title>
</svelte:head>

<div class="page">
  <h1>{t('statusPageTitle')}</h1>
  <p>
    {t('statusSummary', {
      ok: okCount,
      total: modules.length,
      at: formatUpdated(data.health.generatedAt, locale, t),
    })}
  </p>
  <div class="meter" role="img" aria-label="{Math.round(data.health.ok * 100)}%">
    <span style="width: {data.health.ok * 100}%"></span>
  </div>

  {#if failing.length > 0}
    <h2>{t('statusFailing')}</h2>
    {#each failing as [id, m] (id)}
      <div class="fail">
        <strong class="mono">{id}</strong> · {t('statusFailures', { n: m.consecutiveFailures })}
        <div class="muted">{m.error}</div>
      </div>
    {/each}
  {:else}
    <p class="good">{t('statusAllGood')}</p>
  {/if}

  <table>
    <thead>
      <tr>
        <th>{t('statusModule')}</th>
        <th>{t('statusState')}</th>
        <th>{t('statusReleases')}</th>
        <th>{t('statusLastSuccess')}</th>
        <th><span class="visually-hidden">{t('statusWarnings', { n: 2 }).replace(/^\d+ /, '')}</span></th>
      </tr>
    </thead>
    <tbody>
      {#each modules as [id, m] (id)}
        <tr>
          <td>
            {#if id in data.index.products}<a href={resolve('/p/[id]', { id })}
                >{data.index.products[id]?.name ?? id}</a
              >{:else}{id}{/if}
          </td>
          <td class={m.status}>{m.status === 'ok' ? t('statusOkLabel') : t('statusFailedLabel')}</td>
          <td class="mono">{m.releases}</td>
          <td>{m.lastSuccessAt ? formatUpdated(m.lastSuccessAt, locale, t) : t('statusNever')}</td>
          <td class="muted" title={m.warnings.join('\n')}
            >{m.warnings.length ? t('statusWarnings', { n: m.warnings.length }) : ''}</td
          >
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h1 {
    margin: 0;
  }
  h2 {
    margin: 8px 0 0;
    font-size: 18px;
  }
  .meter {
    height: 8px;
    border-radius: 4px;
    background: var(--critical-bg);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    background: var(--ok);
  }
  .fail {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--critical-bg);
    border: 1px solid var(--critical-border);
  }
  .good {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--ok-bg);
    border: 1px solid var(--ok-border);
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
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
  td.ok {
    color: var(--ok);
  }
  td.failed {
    color: var(--critical);
    font-weight: 600;
  }
</style>
