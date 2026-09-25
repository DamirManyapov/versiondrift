<script lang="ts">
  import '$lib/styles/global.css';
  import { onMount, type Snippet } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { feed } from '$lib/feed/state.svelte';
  import { formatUpdated } from '$lib/format';
  import { LOCALES, type Locale } from '$lib/i18n';
  import { i18n, setI18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
  setI18n(() => data.locale);
  // Before any page initializes: pages call inventory.init(), which picks the browser or the server store.
  inventory.configure(() => data.mode);
  const { t } = $derived(i18n());

  onMount(() => void feed.load());

  const views = [
    { href: resolve('/'), key: 'navBoard' },
    { href: resolve('/week'), key: 'navWeek' },
  ] as const;

  function setCookie(name: string, value: string) {
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
  }

  async function setLocale(locale: Locale) {
    setCookie('vd_lang', locale);
    document.documentElement.lang = locale;
    await invalidateAll();
  }

  function setTheme(theme: string) {
    setCookie('vd_theme', theme);
    document.documentElement.dataset.theme = theme;
  }
</script>

<svelte:head>
  <!-- Site-wide social preview (design/og-image.html); pages add og:title/og:description through Meta. -->
  <meta property="og:site_name" content="VersionDrift" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="{page.url.origin}/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content={t('appTagline')} />
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="app">
  <header>
    <a class="brand" href={resolve('/')}>
      <span class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22"
          ><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12 L19 5" /><circle
            cx="12"
            cy="12"
            r="1.2"
          /></svg
        >
      </span>
      <span class="name">VersionDrift</span>
    </a>

    <nav aria-label="Views">
      {#each views as view (view.href)}
        <a href={view.href} aria-current={page.url.pathname === view.href ? 'page' : undefined}
          >{t(view.key)}</a
        >
      {/each}
    </nav>

    <div class="spacer"></div>

    {#if feed.index}
      <div class="updated">
        <span class="muted">{t('feedUpdated')}</span>
        <span>{formatUpdated(feed.index.generatedAt, data.locale, t)}</span>
      </div>
    {/if}
    <button class="ghost" onclick={() => feed.load(true)} disabled={feed.loading}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
        ><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg
      >
      {t('refresh')}
    </button>
    <a class="primary" href={resolve('/catalog')}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      {t('addProduct')}
    </a>
  </header>

  <main>
    {@render children()}
  </main>

  <footer>
    <span>{t('appTagline')}</span>
    <span class="muted">{t('footerData')} · {t('footerCode')}</span>
    <a class="muted" href={resolve('/settings')}>{t('settingsTitle')}</a>
    <a class="muted" href={resolve('/status')}>{t('navStatus')}</a>
    <div class="spacer"></div>
    <label>
      <span class="visually-hidden">{t('language')}</span>
      <select value={data.locale} onchange={(e) => setLocale(e.currentTarget.value as Locale)}>
        {#each LOCALES as locale (locale)}
          <option value={locale}>{locale === 'en' ? 'English' : 'Русский'}</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="visually-hidden">{t('theme')}</span>
      <select value={data.theme} onchange={(e) => setTheme(e.currentTarget.value)}>
        <option value="auto">{t('themeAuto')}</option>
        <option value="dark">{t('themeDark')}</option>
        <option value="light">{t('themeLight')}</option>
      </select>
    </label>
  </footer>
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    min-height: 72px;
    padding: 12px 32px;
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text);
    text-decoration: none;
  }
  .logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--update);
    color: var(--on-update);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
  }
  .name {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  nav {
    display: flex;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 4px;
    gap: 4px;
  }
  nav a {
    padding: 8px 16px;
    border-radius: 7px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-muted);
    text-decoration: none;
  }
  nav a[aria-current='page'] {
    background: var(--text);
    color: var(--bg);
  }
  .spacer {
    flex-grow: 1;
  }
  .updated {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 13px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  .ghost,
  .primary {
    height: 44px;
    padding: 0 16px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    text-decoration: none;
  }
  .ghost {
    border: 1px solid var(--border-strong);
  }
  .ghost:hover {
    background: var(--surface);
  }
  .ghost:disabled {
    opacity: 0.6;
  }
  .primary {
    background: var(--text);
    color: var(--bg);
    font-weight: 600;
  }
  .primary:hover {
    color: var(--bg);
  }
  main {
    flex-grow: 1;
    padding: 24px 32px;
  }
  footer {
    padding: 16px 32px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    font-size: 13px;
  }
  select {
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
  }
  @media (max-width: 720px) {
    header,
    main,
    footer {
      padding-left: 16px;
      padding-right: 16px;
    }
    .updated {
      display: none;
    }
  }
</style>
