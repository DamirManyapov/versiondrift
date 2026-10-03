<script lang="ts">
  // Products followed without a host, under the fleet board: added from the catalog and given a version by hand,
  // like on the public site (a site is a board; these are its own items). With a site chosen they are that board,
  // editable; under "All sites" every site's are shown together, read-only, each labelled with its site.
  import { untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Board from '$lib/components/Board.svelte';
  import type { FleetData } from '$lib/fleet/api';
  import { fleet } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';

  let {
    data,
    site,
    ontoast,
  }: {
    data: FleetData;
    site: number | undefined;
    ontoast: (message: string, undo?: () => void) => void;
  } = $props();
  const { t } = $derived(i18n());
  const canEdit = $derived(page.data.account?.role !== 'viewer');
  const siteName = (id: number) => data.sites.find((s) => s.id === id)?.name ?? '';

  // The chosen site's board becomes the open one, so the catalog and the detail panel edit it.
  $effect(() => {
    if (site !== undefined && inventory.loaded && inventory.boardId !== site) void inventory.openBoard(site);
  });
  // Back on "All sites", the per-site lists come from the fleet answer: refresh it after edits on a site.
  $effect(() => {
    if (site === undefined) untrack(() => void fleet.load());
  });

  const all = $derived(
    data.hostless.flatMap((s) =>
      s.items.map((item) => ({
        ...item,
        label: item.label ? `${siteName(s.siteId)} · ${item.label}` : siteName(s.siteId),
      })),
    ),
  );
  const editable = $derived(site !== undefined && inventory.loaded && inventory.boardId === site);
  const items = $derived(site === undefined ? all : editable ? inventory.data.items : []);
</script>

{#if site !== undefined || all.length > 0}
  <section class="hostless" aria-labelledby="hostless-title">
    <header>
      <div>
        <h2 id="hostless-title">{t('hostlessTitle')}</h2>
        <p class="muted">{site === undefined ? t('hostlessAllHint') : t('hostlessHint')}</p>
      </div>
      {#if canEdit && site !== undefined}
        <a class="button" href={resolve('/catalog')}>{t('addProductLong')}</a>
      {/if}
    </header>
    {#if site !== undefined && !editable}
      <p class="muted">{t('loading')}</p>
    {:else if items.length === 0}
      <p class="muted">{t('hostlessEmpty', { site: siteName(site ?? 0) })}</p>
    {:else}
      <Board
        {items}
        settings={inventory.data.settings}
        readonly={site === undefined || !canEdit}
        summary={false}
        onhideok={(value: boolean) => inventory.setSettings({ hideOk: value })}
        {ontoast}
      />
    {/if}
  </section>
{/if}

<style>
  .hostless {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 18px;
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }
  .button {
    flex-shrink: 0;
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    color: var(--text);
    font-size: 14px;
    text-decoration: none;
  }
</style>
