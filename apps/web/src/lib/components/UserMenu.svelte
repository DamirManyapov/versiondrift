<script lang="ts">
  // The signed-in user's menu in the header (self-hosted): account, settings and signing out in one place instead
  // of a row of buttons. A disclosure, not an ARIA menu: the button opens a panel of ordinary links; Esc, a click
  // elsewhere or a navigation closes it.
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { i18n } from '$lib/i18n/context';

  let { name, role, canSignOut }: { name: string; role: 'admin' | 'viewer'; canSignOut: boolean } = $props();
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
</script>

<svelte:window onclick={outside} onkeydown={escape} />

<div class="menu" bind:this={root}>
  <button
    bind:this={button}
    class="btn trigger"
    aria-expanded={open}
    aria-controls="user-menu"
    aria-label={t('userMenu', { name })}
    onclick={() => (open = !open)}
  >
    <span class="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
    <span class="who">{name}</span>
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
  </button>
  {#if open}
    <div id="user-menu" class="panel">
      <p class="head">
        <strong>{name}</strong>
        <span>{role === 'admin' ? t('roleAdmin') : t('roleViewer')}</span>
      </p>
      <a href={resolve('/account')}>{t('accountTitle')}</a>
      <a href={resolve('/settings')}>{t('settingsTitle')}</a>
      {#if canSignOut}
        <form method="POST" action="/logout" data-sveltekit-reload>
          <button type="submit">{t('signOut')}</button>
        </form>
      {/if}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
  }
  .trigger {
    padding: 0 10px 0 5px;
  }
  .trigger[aria-expanded='true'] {
    background: var(--surface-hover);
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--text);
    color: var(--bg);
    font-size: 13px;
    font-weight: 600;
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
    min-width: 220px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  .head {
    display: flex;
    flex-direction: column;
    margin: 0 0 4px;
    padding: 8px 10px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 14px;
  }
  .head span {
    font-size: 12px;
    color: var(--text-muted);
  }
  .panel a,
  .panel button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 9px 10px;
    border-radius: 8px;
    font-size: 14px;
    color: var(--text);
    text-decoration: none;
  }
  .panel a,
  .panel button {
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
  form {
    margin: 4px 0 0;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }
  /* Narrower screens keep the header on one line: the initial only, the name is in the panel. */
  @media (max-width: 1280px) {
    .who {
      display: none;
    }
  }
</style>
