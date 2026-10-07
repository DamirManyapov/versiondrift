<script lang="ts">
  // The site filter of the fleet screens (docs/specs/fleet-ui.md §3): ?site=<id> in the URL, kept across tabs and
  // remembered in this browser; "All sites" removes it. The last option makes a new site (a small form under it).
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fleet, rememberSite, siteFrom } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { boardsApi } from '$lib/inventory/remote';

  let { sites }: { sites: { id: number; name: string }[] } = $props();
  const { t } = $derived(i18n());
  const current = $derived(siteFrom(page.url, fleet.data));
  const canCreate = $derived(page.data.account?.role !== 'viewer');
  let creating = $state(false);
  let newName = $state('');
  let problem = $state('');
  let input = $state<HTMLInputElement>();
  $effect(() => {
    if (creating) input?.focus();
  });

  function choose(value: string) {
    const id = value === '' ? undefined : Number(value);
    rememberSite(id);
    const url = new URL(page.url);
    if (id === undefined) url.searchParams.delete('site');
    else url.searchParams.set('site', String(id));
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes
    void goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function change(select: HTMLSelectElement) {
    if (select.value !== 'new') return choose(select.value);
    select.value = current === undefined ? '' : String(current);
    newName = '';
    problem = '';
    creating = true;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const site = await boardsApi.create(newName);
      await fleet.load();
      creating = false;
      choose(String(site.id));
    } catch (error) {
      problem = (error as Error).message;
    }
  }
</script>

<div class="wrap">
  <label class="site">
    <span class="muted">{t('siteLabel')}:</span>
    <select
      class="input"
      value={current === undefined ? '' : String(current)}
      onchange={(e) => change(e.currentTarget)}
    >
      <option value="" selected={current === undefined}>{t('allSites')}</option>
      {#each sites as site (site.id)}<option value={String(site.id)} selected={site.id === current}
          >{site.name}</option
        >{/each}
      {#if canCreate}<option value="new">{t('newSiteOption')}</option>{/if}
    </select>
  </label>
  {#if creating}
    <form class="panel" onsubmit={create}>
      <input
        class="input"
        bind:this={input}
        onkeydown={(e) => {
          if (e.key === 'Escape') creating = false;
        }}
        bind:value={newName}
        aria-label={t('newSiteName')}
        placeholder={t('newSiteName')}
        maxlength="60"
        required
      />
      <div class="actions">
        <button class="btn btn-sm btn-primary" type="submit">{t('create')}</button>
        <button class="btn btn-sm" type="button" onclick={() => (creating = false)}>{t('cancel')}</button>
      </div>
      {#if problem}<p class="error" role="alert">{problem}</p>{/if}
    </form>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  /* The select is the control (40px, like the buttons next to it); its label sits in front of it. */
  .site {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .muted {
    color: var(--text-muted);
  }
  select {
    font-weight: 600;
    min-width: 170px;
  }
  .panel {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: 280px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .error {
    margin: 0;
    font-size: 13px;
    color: var(--critical);
  }
</style>
