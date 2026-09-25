<script lang="ts">
  // Settings, self-hosted: rename and delete boards (deleting asks once more, inline — no browser dialogs).
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());
  let editing = $state<number | undefined>();
  let name = $state('');
  let confirming = $state<number | undefined>();
  let problem = $state('');

  async function run(action: () => Promise<void>) {
    try {
      await action();
      problem = '';
    } catch (error) {
      problem = (error as Error).message;
    }
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
  <h2>{t('boardsTitle')}</h2>
  <p class="muted">{t('boardsHint')}</p>
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
          <span class="name">{board.name}</span>
          <button
            onclick={() => {
              editing = board.id;
              name = board.name;
            }}>{t('rename')}</button
          >
          {#if inventory.boards.length > 1}
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
