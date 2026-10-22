<script lang="ts">
  // The signed-in user's menu in the header (self-hosted): the sections of Settings and signing out in one place
  // (docs/06). Without sign-in (VD_AUTH=none) it is a settings menu behind a gear: no name, no account, no sign-out.
  // A disclosure, not an ARIA menu: the button opens a panel of ordinary links; Esc, a click elsewhere or a navigation
  // closes it.
  import { afterNavigate } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { fleet } from '$lib/fleet/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { settingsSections } from '$lib/settings/sections';

  let { account }: { account: { name: string; role: 'admin' | 'viewer'; auth: string } } = $props();
  const { t } = $derived(i18n());
  const { name, role } = $derived(account);
  const anonymous = $derived(account.auth === 'none');
  const canSignOut = $derived(account.auth === 'password' || account.auth === 'oidc');
  // Account first (who you are), then the sections, then "Settings" for the general one (the mock-up in docs/06).
  const links = $derived.by(() => {
    const sections = settingsSections('selfhosted', account, fleet.hasHosts);
    const general = sections.find((s) => s.path === '/settings');
    const own = sections.find((s) => s.path === '/settings/account');
    const rest = sections.filter((s) => s !== general && s !== own);
    return [own, ...rest, general && { ...general, key: 'settingsTitle' as const }].filter((s) => !!s);
  });
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
    type="button"
    bind:this={button}
    class="btn trigger"
    class:gear={anonymous}
    aria-expanded={open}
    aria-controls="user-menu"
    aria-label={anonymous ? t('settingsTitle') : t('userMenu', { name })}
    onclick={() => (open = !open)}
  >
    {#if anonymous}
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
        ><circle cx="12" cy="12" r="3" /><path
          d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
        /></svg
      >
    {:else}
      <span class="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <span class="who">{name}</span>
    {/if}
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
  </button>
  {#if open}
    <div id="user-menu" class="panel">
      {#if !anonymous}<p class="head">
          <strong>{name}</strong>
          <span>{role === 'admin' ? t('roleAdmin') : t('roleViewer')}</span>
        </p>{/if}
      {#each links as link (link.path)}
        <a href={resolve(link.path)}>{t(link.key)}</a>
      {/each}
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
  .trigger.gear {
    padding: 0 8px 0 10px;
    gap: 4px;
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
