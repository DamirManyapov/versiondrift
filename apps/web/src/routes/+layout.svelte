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
  import AddHosts from '$lib/components/fleet/AddHosts.svelte';
  import SiteSwitcher from '$lib/components/fleet/SiteSwitcher.svelte';
  import UserMenu from '$lib/components/UserMenu.svelte';
  import AddMenu from '$lib/components/AddMenu.svelte';
  import { goto } from '$app/navigation';
  import { fleet, siteFrom } from '$lib/fleet/state.svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
  setI18n(() => data.locale);
  // Before any page initializes: pages call inventory.init(), which picks the browser or the server store.
  inventory.configure(() => data.mode);
  const { t } = $derived(i18n());

  // The feed's freshness in the footer, a traffic light with words: rebuilt daily at 02:00 UTC, so a day and a half
  // is on time, up to a week is late, older is out of date.
  const FRESHNESS = { fresh: 'feedFresh', late: 'feedLate', old: 'feedOld' } as const;
  const freshness = $derived.by((): keyof typeof FRESHNESS | 'missing' | undefined => {
    if (feed.error && !feed.index) return 'missing';
    if (!feed.index) return undefined;
    const hours = (Date.now() - Date.parse(feed.index.generatedAt)) / 3_600_000;
    return hours <= 36 ? 'fresh' : hours <= 7 * 24 ? 'late' : 'old';
  });
  const freshnessLabel = $derived(freshness && freshness !== 'missing' ? t(FRESHNESS[freshness]) : '');

  onMount(() => {
    void feed.load();
    if (data.mode === 'selfhosted') void fleet.load();
  });

  // Self-hosted with hosts: Board · Hosts · This week · Access profiles (docs/specs/fleet-ui.md §3).
  const views = $derived(
    fleet.hasHosts
      ? ([
          { href: resolve('/'), key: 'navBoard', count: undefined },
          { href: resolve('/hosts'), key: 'navHosts', count: fleet.data?.hosts.length },
          { href: resolve('/week'), key: 'navWeek', count: undefined },
          { href: resolve('/access-profiles'), key: 'navProfiles', count: undefined },
        ] as const)
      : ([
          { href: resolve('/'), key: 'navBoard', count: undefined },
          { href: resolve('/week'), key: 'navWeek', count: undefined },
        ] as const),
  );
  // "Add hosts" is a dialog over any page: ?add=one or ?add=csv (docs/specs/fleet-ui.md §3).
  const canAddHosts = $derived(
    data.mode === 'selfhosted' && data.account !== null && data.account.role !== 'viewer',
  );
  // Self-hosted before signing in: only the logo (UI audit P1-6); the language and theme stay in the footer.
  const signedOut = $derived(data.mode === 'selfhosted' && data.account === null);
  const addTab = $derived.by(() => {
    const value = page.url.searchParams.get('add');
    return canAddHosts && (value === 'one' || value === 'csv') ? value : undefined;
  });
  function setAdd(value: 'one' | 'csv' | undefined) {
    const url = new URL(page.url);
    if (value) url.searchParams.set('add', value);
    else url.searchParams.delete('add');
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the query changes
    void goto(url, { replaceState: !value, keepFocus: true, noScroll: true });
  }

  const current = (href: string) =>
    href === resolve('/') ? page.url.pathname === href : page.url.pathname.startsWith(href);

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

    {#if !signedOut}<nav aria-label="Views">
        {#each views as view (view.href)}
          <a href={view.href} aria-current={current(view.href) ? 'page' : undefined}
            >{t(view.key)}{#if view.count !== undefined}<span class="count">{view.count}</span>{/if}</a
          >
        {/each}
      </nav>{/if}

    <div class="spacer"></div>

    {#if fleet.hasHosts && fleet.data}
      <SiteSwitcher sites={fleet.data.sites} />
    {/if}
    {#if canAddHosts}
      <AddMenu onhosts={setAdd} />
    {:else if !signedOut && data.account?.role !== 'viewer'}
      <a class="btn btn-primary" href={resolve('/catalog')}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {t('addProduct')}
      </a>
    {/if}
    {#if data.account && data.account.auth !== 'none'}
      <UserMenu
        name={data.account.name}
        role={data.account.role}
        canSignOut={data.account.auth === 'password' || data.account.auth === 'oidc'}
      />
    {/if}
  </header>

  <main>
    {@render children()}
  </main>
  {#if addTab}
    <AddHosts tab={addTab} site={siteFrom(page.url, fleet.data)} onclose={() => setAdd(undefined)} />
  {/if}

  <footer>
    <span>{t('appTagline')}</span>
    <span class="muted">{t('footerData')} · {t('footerCode')}</span>
    <a class="muted footlink" href={resolve('/settings')}>{t('settingsTitle')}</a>
    <a class="muted feed-state" href={resolve('/status')}>
      {#if freshness === 'missing'}
        <span class="dot missing" aria-hidden="true"></span>{t('feedMissing')}
      {:else if freshness && feed.index}
        <span class="dot {freshness}" aria-hidden="true"></span>{freshnessLabel} · {formatUpdated(
          feed.index.generatedAt,
          data.locale,
          t,
        )}
      {:else}
        {t('navStatus')}
      {/if}
    </a>
    <div class="spacer"></div>
    <label>
      <span class="visually-hidden">{t('language')}</span>
      <select
        class="input input-sm"
        value={data.locale}
        onchange={(e) => setLocale(e.currentTarget.value as Locale)}
      >
        {#each LOCALES as locale (locale)}
          <option value={locale}>{locale === 'en' ? 'English' : 'Русский'}</option>
        {/each}
      </select>
    </label>
    <label>
      <span class="visually-hidden">{t('theme')}</span>
      <select class="input input-sm" value={data.theme} onchange={(e) => setTheme(e.currentTarget.value)}>
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
  /* A segmented control as tall as the other header controls: 3 + 32 + 3 px inside a 1 px border. */
  nav {
    display: flex;
    height: var(--control-h);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--control-radius);
    padding: 3px;
    gap: 3px;
  }
  nav a {
    display: flex;
    align-items: center;
    padding: 0 14px;
    border-radius: var(--control-radius-sm);
    font-size: 14px;
    font-weight: 500;
    color: var(--text-muted);
    text-decoration: none;
    transition:
      background-color 0.12s,
      color 0.12s;
  }
  nav a:hover:not([aria-current='page']) {
    background: var(--surface-hover);
    color: var(--text);
  }
  nav a:active:not([aria-current='page']) {
    background: var(--surface-active);
  }
  nav a[aria-current='page'] {
    background: var(--text);
    color: var(--bg);
  }
  .count {
    margin-left: 6px;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .spacer {
    flex-grow: 1;
  }
  .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  main {
    flex-grow: 1;
    padding: 24px 32px;
  }
  /* Footer links: a 32px target (UI audit P1-2); the feed status is a chip with its light. */
  .footlink,
  .feed-state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--control-h-sm);
    padding: 0 8px;
    border-radius: var(--control-radius-sm);
    text-decoration: none;
    transition: background-color 0.12s;
  }
  .feed-state {
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  .footlink:hover,
  .feed-state:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.fresh {
    background: var(--ok);
  }
  .dot.late {
    background: var(--update);
  }
  .dot.old,
  .dot.missing {
    background: var(--critical);
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
  @media (max-width: 720px) {
    header,
    main,
    footer {
      padding-left: 16px;
      padding-right: 16px;
    }
  }
</style>
