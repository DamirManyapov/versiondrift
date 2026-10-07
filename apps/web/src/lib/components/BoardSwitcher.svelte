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
      class="input input-sm"
      value={inventory.boardId}
      onchange={(e) => {
        start('pick');
        void inventory.openBoard(Number(e.currentTarget.value));
      }}
    >
      <!-- The options arrive after the value: mark the chosen one itself, or the first would show. -->
      {#each inventory.boards as board (board.id)}<option
          value={board.id}
          selected={board.id === inventory.boardId}>{board.name}</option
        >{/each}
    </select>
  </div>
  {#if mode === 'create' || mode === 'rename'}
    <form onsubmit={submit}>
      <input
        class="input input-sm"
        bind:value={name}
        aria-label={t('boardName')}
        placeholder={t('boardName')}
        maxlength="60"
        required
      />
      <button class="btn btn-sm btn-primary" type="submit"
        >{mode === 'rename' ? t('save') : t('create')}</button
      >
      <button class="btn btn-sm" type="button" onclick={() => start('pick')}>{t('cancel')}</button>
    </form>
  {:else if mode === 'delete' && current}
    {#if inventory.boards.length > 1}
      <button class="btn btn-sm btn-danger" onclick={() => void run(() => inventory.deleteBoard(current.id))}
        >{t('deleteBoardConfirm', { name: current.name })}</button
      >
    {:else}
      <span class="muted" role="status">{t('lastBoardHint')}</span>
    {/if}
    <button class="btn btn-sm" onclick={() => start('pick')}>{t('cancel')}</button>
  {:else}
    <button class="btn btn-sm" onclick={() => start('rename')}>{t('rename')}</button>
    <button class="btn btn-sm btn-danger-ghost" onclick={() => start('delete')}>{t('deleteBoard')}</button>
    <button class="btn btn-sm" onclick={() => start('create')}>+ {t('newBoard')}</button>
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
  .error {
    color: var(--critical);
    font-size: 13px;
  }
</style>
