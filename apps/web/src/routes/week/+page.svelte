<script lang="ts">
  import { onMount } from 'svelte';
  import type { WeekDigest } from '@versiondrift/schema';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { productCache } from '$lib/board/products.svelte';
  import { relevanceOf, type Relevance } from '$lib/board/relevance';
  import TypeChip from '$lib/components/TypeChip.svelte';
  import { feed } from '$lib/feed/state.svelte';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';
  import { isoWeek, mondayOf, shiftWeek, weekId } from '$lib/week';

  const { t, locale } = $derived(i18n());
  const current = weekId(isoWeek(new Date()));
  const oldest = shiftWeek(current, -11) ?? current;
  const id = $derived(page.url.searchParams.get('w') ?? current);
  let digest = $state<WeekDigest | undefined>();
  let missing = $state(false);

  onMount(() => inventory.init());

  $effect(() => {
    const wanted = id;
    missing = false;
    feed.client.week(wanted).then(
      (d) => {
        if (id !== wanted) return;
        digest = d;
        missing = d === undefined;
      },
      () => (missing = true),
    );
  });

  const onBoard = $derived(new Set(inventory.data.items.map((i) => i.p)));
  const entries = $derived(
    (digest?.entries ?? []).filter((e) => onBoard.size === 0 || onBoard.has(e.product)),
  );
  $effect(() => {
    if (feed.index) void productCache.ensure(entries.map((e) => e.product));
  });

  const REL_KEYS = {
    affectsYouSecurity: 'relAffectsYouSecurity',
    affectsYou: 'relAffectsYou',
    installed: 'relInstalled',
    otherTrack: 'relOtherTrack',
    notOnBoard: 'relNotOnBoard',
  } as const;

  const rows = $derived(
    entries.map((e) => {
      const product = productCache.products[e.product];
      const relevance: Relevance = relevanceOf(
        product,
        e.version,
        e.types.includes('security'),
        inventory.data.items.filter((i) => i.p === e.product),
      );
      const release = product?.releases.find((r) => r.version === e.version);
      return { ...e, relevance, release, name: feed.index?.products[e.product]?.name ?? e.product };
    }),
  );
  const mine = $derived(
    rows.filter((r) => r.relevance === 'affectsYou' || r.relevance === 'affectsYouSecurity').length,
  );
  const security = $derived(rows.filter((r) => r.relevance === 'affectsYouSecurity').length);

  const range = $derived.by(() => {
    const monday = mondayOf(id);
    if (!monday) return id;
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${fmt.format(monday)} – ${fmt.format(sunday)}`;
  });
  const days = $derived.by(() => {
    const groups: { day: string; items: typeof rows }[] = [];
    for (const row of rows) {
      const day = row.date.slice(0, 10);
      const group = groups.find((g) => g.day === day);
      if (group) group.items.push(row);
      else groups.push({ day, items: [row] });
    }
    return groups;
  });
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${day}T12:00:00Z`));
  const prev = $derived(id > oldest ? shiftWeek(id, -1) : undefined);
  const next = $derived(id < current ? shiftWeek(id, 1) : undefined);
  const hrefFor = (w: string) => resolve('/week') + (w === current ? '' : `?w=${w}`);
</script>

<svelte:head><title>{t('weekTitle')} · {range} · VersionDrift</title></svelte:head>

<div class="week">
  <header>
    {#if prev}
      <a class="nav" href={hrefFor(prev)} aria-label={t('prevWeek')}>‹</a>
    {:else}
      <span class="nav off" aria-hidden="true">‹</span>
    {/if}
    <div class="col">
      <h1>{t('weekTitle')}: {range}</h1>
      {#if digest}
        <p class="muted">
          {onBoard.size === 0
            ? t('weekSummaryAll', { releases: t('weekReleases', { n: rows.length }) })
            : t('weekSummary', { releases: t('weekReleases', { n: rows.length }), mine, security })}
        </p>
      {/if}
    </div>
    {#if next}
      <a class="nav" href={hrefFor(next)} aria-label={t('nextWeek')}>›</a>
    {:else}
      <span class="nav off" aria-hidden="true">›</span>
    {/if}
  </header>

  {#if missing}
    <p class="muted">{t('weekOutOfRange')}</p>
  {:else if !digest}
    <p class="muted">{t('loading')}</p>
  {:else if rows.length === 0}
    <p class="quiet">{t('quietWeek')}</p>
  {:else}
    {#each days as group (group.day)}
      <section>
        <h2 class="muted">{dayLabel(group.day)}</h2>
        {#each group.items as row (row.product + row.version)}
          <article class="entry {row.relevance}">
            <div class="line">
              <strong>{row.name}</strong>
              {#if row.release?.url}
                <a class="mono" href={row.release.url} target="_blank" rel="noreferrer">{row.version}</a>
              {:else}<span class="mono">{row.version}</span>{/if}
              <span class="grow"></span>
              {#if t(REL_KEYS[row.relevance])}<span class="rel">{t(REL_KEYS[row.relevance])}</span>{/if}
            </div>
            {#each (row.release?.items ?? []).slice(0, 4) as item, i (i)}
              <div class="item"><TypeChip type={item.type} /><span>{item.text}</span></div>
            {/each}
          </article>
        {/each}
      </section>
    {/each}
  {/if}
</div>

<style>
  .week {
    max-width: 920px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .col {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 500;
    text-transform: capitalize;
  }
  .muted {
    color: var(--text-muted);
    font-size: 14px;
    margin: 0;
  }
  .quiet {
    padding: 48px;
    text-align: center;
    color: var(--text-muted);
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
    text-decoration: none;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    font-size: 22px;
    text-align: center;
  }
  .nav.off {
    opacity: 0.35;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .entry {
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .entry.affectsYouSecurity {
    border-color: var(--critical-border);
  }
  .entry.affectsYou {
    border-color: var(--update-border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .grow {
    flex-grow: 1;
  }
  .rel {
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    background: var(--surface-3);
  }
  .affectsYouSecurity .rel {
    background: var(--critical);
    color: var(--on-critical);
  }
  .affectsYou .rel {
    background: var(--update);
    color: var(--on-update);
  }
  .item {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-soft);
  }
</style>
