<script lang="ts">
  // "+ Add" in the header (UI audit P1-3): one primary action instead of two buttons of different weight. A
  // disclosure, like the account menu: hosts (one, or a CSV list) open the add-hosts dialog, a product opens the
  // catalog. Esc, a click elsewhere or a navigation closes it.
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { i18n } from '$lib/i18n/context';

  let { onhosts }: { onhosts: (tab: 'one' | 'csv') => void } = $props();
  const { t } = $derived(i18n());
  let open = $state(false);
  let root: HTMLElement;
  let button: HTMLButtonElement;

  afterNavigate(() => (open = false));
  const outside = (event: MouseEvent) => {
    if (open && !root.contains(event.target as Node)) open = false;
  };
  const escape = (event: KeyboardEvent) => {
    if (open && event.key === 'Escape') {
      open = false;
      button.focus();
    }
  };
  function hosts(tab: 'one' | 'csv') {
    open = false;
    onhosts(tab);
  }
</script>

<svelte:window onclick={outside} onkeydown={escape} />

<div class="menu" bind:this={root}>
  <button
    bind:this={button}
    class="btn btn-primary"
    aria-expanded={open}
    aria-controls="add-menu"
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    {t('addMenu')}
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
  </button>
  {#if open}
    <div id="add-menu" class="panel">
      <button onclick={() => hosts('one')}>
        <strong>{t('addMenuHost')}</strong><span>{t('addMenuHostHint')}</span>
      </button>
      <button onclick={() => hosts('csv')}>
        <strong>{t('addMenuCsv')}</strong><span>{t('addMenuCsvHint')}</span>
      </button>
      <a href={resolve('/catalog')}>
        <strong>{t('addMenuProduct')}</strong><span>{t('addMenuProductHint')}</span>
      </a>
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
  }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    width: 300px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  .panel a,
  .panel button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border-radius: 8px;
    color: var(--text);
    text-decoration: none;
    transition: background-color 0.12s;
  }
  .panel a:hover,
  .panel button:hover {
    background: var(--surface-hover);
  }
  .panel a:active,
  .panel button:active {
    background: var(--surface-active);
  }
  strong {
    font-size: 14px;
    font-weight: 600;
  }
  span {
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
