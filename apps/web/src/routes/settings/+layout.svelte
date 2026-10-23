<script lang="ts">
  // Settings (docs/06): self-hosted splits them into sections with a menu on the left (a row on top on phones); the
  // public site has one page. The inventory is loaded here once for every section.
  import { onMount, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { fleet } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';
  import { settingsSections } from '$lib/settings/sections';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
  const { t } = $derived(i18n());
  const sections = $derived(settingsSections(data.mode, data.account, fleet.hasHosts));
  const current = $derived(sections.find((s) => s.path === page.url.pathname && s.path !== '/settings'));
  const title = $derived(
    [current && t(current.key), t('settingsTitle'), 'VersionDrift'].filter(Boolean).join(' · '),
  );

  onMount(() => inventory.init());
</script>

<svelte:head><title>{title}</title></svelte:head>

<div class="settings" class:split={sections.length > 0}>
  <h1>{t('settingsTitle')}</h1>
  {#if sections.length > 0}
    <nav aria-label={t('settingsTitle')}>
      {#each sections as section (section.path)}
        <a href={resolve(section.path)} aria-current={section.path === page.url.pathname ? 'page' : undefined}
          >{t(section.key)}</a
        >
      {/each}
    </nav>
  {/if}
  <div class="content">{@render children()}</div>
</div>

<style>
  .settings {
    max-width: 720px;
    margin: 0 auto;
    display: grid;
    gap: 24px;
  }
  .settings.split {
    max-width: 980px;
    grid-template-columns: 200px minmax(0, 1fr);
    grid-template-areas: 'title title' 'nav content';
    column-gap: 32px;
    align-items: start;
  }
  h1 {
    margin: 0;
  }
  /* The named areas exist only in the split layout: elsewhere they would all land in one implicit cell. */
  .split h1 {
    grid-area: title;
  }
  .split .content {
    grid-area: content;
  }
  nav {
    grid-area: nav;
    position: sticky;
    top: 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  nav a {
    display: flex;
    align-items: center;
    min-height: var(--control-h);
    padding: 0 12px;
    border-radius: 8px;
    color: var(--text-soft);
    text-decoration: none;
    font-size: 14px;
    transition: background-color 0.12s;
  }
  nav a:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  nav a[aria-current='page'] {
    background: var(--selected-bg);
    color: var(--text);
    font-weight: 600;
    box-shadow: inset 2px 0 0 var(--selected);
  }
  .content {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  /* Narrow screens: the sections are a row on top that scrolls sideways. */
  @media (max-width: 720px) {
    .settings.split {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'title' 'nav' 'content';
      row-gap: 16px;
    }
    nav {
      position: static;
      flex-direction: row;
      overflow-x: auto;
      gap: 6px;
      margin: 0 -16px;
      padding: 0 16px 4px;
      border-bottom: 1px solid var(--border);
    }
    nav a {
      flex: 0 0 auto;
      white-space: nowrap;
    }
    nav a[aria-current='page'] {
      box-shadow: inset 0 -2px 0 var(--selected);
    }
  }
</style>
