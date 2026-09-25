<script lang="ts">
  // Self-hosted: pick one of the instance's boards or create another ("Prod", "Homelab"; docs/07).
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());
  let creating = $state(false);
  let name = $state('');
  let problem = $state('');

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      await inventory.createBoard(name);
      creating = false;
      name = '';
      problem = '';
    } catch (error) {
      problem = (error as Error).message;
    }
  }
</script>

<div class="boards">
  <div class="pick">
    <label class="muted" for="board-pick">{t('boardLabel')}</label>
    <select
      id="board-pick"
      value={inventory.boardId}
      onchange={(e) => void inventory.openBoard(Number(e.currentTarget.value))}
    >
      {#each inventory.boards as board (board.id)}<option value={board.id}>{board.name}</option>{/each}
    </select>
  </div>
  {#if creating}
    <form onsubmit={create}>
      <input
        bind:value={name}
        aria-label={t('boardName')}
        placeholder={t('boardName')}
        maxlength="60"
        required
      />
      <button class="primary" type="submit">{t('create')}</button>
      <button type="button" onclick={() => (creating = false)}>{t('cancel')}</button>
    </form>
  {:else}
    <button onclick={() => (creating = true)}>+ {t('newBoard')}</button>
  {/if}
  {#if problem}<span class="error" role="alert">{problem}</span>{/if}
</div>

<style>
  .boards {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  form {
    display: flex;
    gap: 8px;
  }
  select,
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
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-strong);
    color: var(--text-soft);
  }
  .primary {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
  }
  .error {
    color: var(--critical);
    font-size: 13px;
  }
</style>
