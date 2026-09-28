<script lang="ts">
  // The site filter of the fleet screens (docs/specs/fleet-ui.md §3): ?site=<id> in the URL, kept across tabs and
  // remembered in this browser; "All sites" removes it.
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fleet, rememberSite, siteFrom } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';

  let { sites }: { sites: { id: number; name: string }[] } = $props();
  const { t } = $derived(i18n());
  const current = $derived(siteFrom(page.url, fleet.data));

  function choose(value: string) {
    const id = value === '' ? undefined : Number(value);
    rememberSite(id);
    const url = new URL(page.url);
    if (id === undefined) url.searchParams.delete('site');
    else url.searchParams.set('site', String(id));
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

<label class="site">
  <span class="muted">{t('siteLabel')}:</span>
  <select
    value={current === undefined ? '' : String(current)}
    onchange={(e) => choose(e.currentTarget.value)}
  >
    <option value="">{t('allSites')}</option>
    {#each sites as site (site.id)}<option value={String(site.id)}>{site.name}</option>{/each}
  </select>
</label>

<style>
  .site {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    font-size: 14px;
  }
  .muted {
    color: var(--text-muted);
  }
  select {
    font: inherit;
    font-weight: 600;
    color: var(--text);
    background: transparent;
    border: 0;
  }
</style>
