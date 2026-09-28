<script lang="ts">
  // Self-hosted: pick one of the instance's boards, create, rename or delete one ("Prod", "Homelab"; docs/07).
  // Deleting asks once more, inline (no browser dialogs); the last board stays, and says why.
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());
  let mode = $state<'pick' | 'create' | 'rename' | 'delete'>('pick');
  let name = $state('');
  let problem = $state('');
  const current = $derived(inventory.boards.find((b) => b.id === inventory.boardId));

  function start(next: typeof mode) {
    mode = next;
    name = next === 'rename' ? (current?.name ?? '') : '';
    problem = '';
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
      start('pick');
    } catch (error) {
      problem = (error as Error).message;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void run(() =>
      mode === 'rename' && current ? inventory.renameBoard(current.id, name) : inventory.createBoard(name),
    );
  }
</script>

<div class="boards">
  <div class="pick">
    <label class="muted" for="board-pick">{t('boardLabel')}</label>
    <select
      id="board-pick"
      value={inventory.boardId}
      onchange={(e) => {
        start('pick');
        void inventory.openBoard(Number(e.currentTarget.value));
      }}
    >
      {#each inventory.boards as board (board.id)}<option value={board.id}>{board.name}</option>{/each}
    </select>
  </div>
  {#if mode === 'create' || mode === 'rename'}
    <form onsubmit={submit}>
      <input
        bind:value={name}
        aria-label={t('boardName')}
        placeholder={t('boardName')}
        maxlength="60"
        required
      />
      <button class="primary" type="submit">{mode === 'rename' ? t('save') : t('create')}</button>
      <button type="button" onclick={() => start('pick')}>{t('cancel')}</button>
    </form>
  {:else if mode === 'delete' && current}
    {#if inventory.boards.length > 1}
      <button class="danger" onclick={() => void run(() => inventory.deleteBoard(current.id))}
        >{t('deleteBoardConfirm', { name: current.name })}</button
      >
    {:else}
      <span class="muted" role="status">{t('lastBoardHint')}</span>
    {/if}
    <button onclick={() => start('pick')}>{t('cancel')}</button>
  {:else}
    <button onclick={() => start('rename')}>{t('rename')}</button>
    <button onclick={() => start('delete')}>{t('deleteBoard')}</button>
    <button onclick={() => start('create')}>+ {t('newBoard')}</button>
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
  .danger {
    color: var(--critical);
    border-color: var(--critical-border);
    background: var(--critical-bg);
  }
  .error {
    color: var(--critical);
    font-size: 13px;
  }
</style>
