<script lang="ts">
  // Settings, self-hosted: create, rename and delete boards — sites once there are hosts (a site is a board).
  // Deleting asks once more, inline (no browser dialogs); a site with hosts can't be deleted until they are gone.
  import { fleet } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());
  let editing = $state<number | undefined>();
  let name = $state('');
  let confirming = $state<number | undefined>();
  let problem = $state('');
  let newName = $state('');
  const sites = $derived(fleet.hasHosts);
  const hostCount = (id: number) => fleet.data?.hosts.filter((h) => h.siteId === id).length ?? 0;

  async function run(action: () => Promise<void>) {
    try {
      await action();
      problem = '';
      if (fleet.data) await fleet.load();
    } catch (error) {
      problem = (error as Error).message;
    }
  }

  function create(event: SubmitEvent) {
    event.preventDefault();
    void run(async () => {
      await inventory.createBoard(newName);
      newName = '';
    });
  }

  function rename(event: SubmitEvent, id: number) {
    event.preventDefault();
    void run(async () => {
      await inventory.renameBoard(id, name);
      editing = undefined;
    });
  }
</script>

<section>
  <h2>{sites ? t('sitesTitle') : t('boardsTitle')}</h2>
  <p class="muted">{sites ? t('sitesHint') : t('boardsHint')}</p>
  <ul>
    {#each inventory.boards as board (board.id)}
      <li>
        {#if editing === board.id}
          <form onsubmit={(e) => rename(e, board.id)}>
            <input bind:value={name} aria-label={t('boardName')} maxlength="60" required />
            <button class="primary" type="submit">{t('save')}</button>
            <button type="button" onclick={() => (editing = undefined)}>{t('cancel')}</button>
          </form>
        {:else}
          <span class="name"
            >{board.name}{#if sites}<span class="muted count"
                >{t('hostsCount', { n: hostCount(board.id) })}</span
              >{/if}</span
          >
          <button
            onclick={() => {
              editing = board.id;
              name = board.name;
            }}>{t('rename')}</button
          >
          {#if inventory.boards.length > 1 && sites && hostCount(board.id) > 0}
            <span class="muted">{t('siteHasHosts')}</span>
          {:else if inventory.boards.length > 1}
            {#if confirming === board.id}
              <button class="danger" onclick={() => void run(() => inventory.deleteBoard(board.id))}
                >{t('deleteBoardConfirm', { name: board.name })}</button
              >
              <button onclick={() => (confirming = undefined)}>{t('cancel')}</button>
            {:else}
              <button onclick={() => (confirming = board.id)}>{t('deleteBoard')}</button>
            {/if}
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
  <form class="new" onsubmit={create}>
    <input
      bind:value={newName}
      aria-label={sites ? t('newSiteName') : t('boardName')}
      placeholder={sites ? t('newSiteName') : t('boardName')}
      maxlength="60"
      required
    />
    <button class="primary" type="submit">{sites ? t('newSite') : t('newBoard')}</button>
  </form>
  {#if problem}<p class="error" role="alert">{problem}</p>{/if}
</section>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li,
  form {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .name {
    font-weight: 600;
    min-width: 140px;
  }
  .count {
    margin-left: 8px;
    font-weight: 400;
  }
  .new {
    margin-top: 12px;
  }
  .new input {
    min-width: 260px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  input {
    font: inherit;
    font-size: 14px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 6px 10px;
  }
  button {
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-strong);
    color: var(--text-soft);
  }
  .primary {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
  .danger {
    border-color: var(--critical-border);
    color: var(--critical);
  }
  .error {
    color: var(--critical);
  }
</style>
