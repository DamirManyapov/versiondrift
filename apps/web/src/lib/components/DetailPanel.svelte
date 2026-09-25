<script lang="ts">
  import { parse } from '@versiondrift/core';
  import type { ItemType, Release } from '@versiondrift/schema';
  import type { Row } from '$lib/board/rows';
  import { REPO_URL } from '$lib/config';
  import { feed } from '$lib/feed/state.svelte';
  import { formatDate } from '$lib/format';
  import { i18n } from '$lib/i18n/context';
  import { inventory } from '$lib/inventory/state.svelte';
  import StatusChip from './StatusChip.svelte';
  import TypeChip from './TypeChip.svelte';

  let {
    row,
    onclose,
    ontoast,
  }: {
    row: Row;
    onclose?: (() => void) | undefined;
    ontoast: (message: string, undo?: () => void) => void;
  } = $props();

  const { t, locale } = $derived(i18n());
  const TYPES: ItemType[] = ['security', 'breaking', 'deprecated', 'feature', 'fix'];
  const IMPORTANT = new Set<ItemType>(['security', 'breaking', 'deprecated']);
  const WEEK = 7 * 86_400_000;

  let chosen = $state<number | undefined>();
  let tab = $state<'changes' | 'vulns' | 'module'>('changes');
  let importantOnly = $state(false);
  let draft = $state<string | undefined>();

  const instance = $derived(row.instances.find((i) => i.index === chosen) ?? row.primary);
  const s = $derived(instance?.status);
  const product = $derived(row.product);
  const entry = $derived(feed.index?.products[row.id]);
  const versionInput = $derived(draft ?? instance?.item.ver ?? '');
  const versionError = $derived.by(() => {
    const value = versionInput.trim();
    if (!value || !product) return '';
    if (!parse(product, value)) return t('versionInvalid', { version: value, scheme: product.versionScheme });
    return s?.flags.includes('unknownVersion') ? t('versionUnknown', { version: value }) : '';
  });
  const releasesForPicker = $derived(product?.releases.filter((r) => !r.prerelease).slice(0, 300) ?? []);
  const recent = $derived(product?.releases.filter((r) => !r.prerelease).slice(0, 5) ?? []);
  const isThisWeek = (r: Release) => Date.now() - Date.parse(r.date ?? r.firstSeenAt) <= WEEK;

  function commitVersion() {
    if (!instance || draft === undefined) return;
    const value = draft.trim();
    draft = undefined;
    if (value === (instance.item.ver ?? '')) return;
    inventory.update(instance.index, { ver: value });
  }

  function markUpdated() {
    if (!instance || !s?.latest) return;
    const previous = instance.item.ver;
    const index = instance.index;
    inventory.update(index, { ver: s.latest });
    ontoast(t('updatedTo', { name: row.name, version: s.latest }), () =>
      inventory.update(index, { ver: previous ?? '' }),
    );
  }

  function setTrack(value: string) {
    if (instance) inventory.update(instance.index, { track: value });
  }

  function fixedIn(affected: { fixed?: string | undefined }[]): string | undefined {
    return affected.find((a) => a.fixed)?.fixed;
  }
</script>

<section class="panel" aria-labelledby="detail-title">
  <header class="top">
    <div class="grow">
      <h2 id="detail-title">{row.name}</h2>
      <div class="muted">
        {row.category} · {t('moduleFile')}
        <a class="mono" href="{REPO_URL}/blob/main/products/{row.id}.yaml" target="_blank" rel="noreferrer"
          >products/{row.id}.yaml</a
        >
      </div>
    </div>
    {#if row.known}<StatusChip status={row.status} cvss={s?.maxCvss} size="md" />{/if}
    {#if onclose}
      <button class="icon" onclick={onclose} aria-label={t('closePanel')}>✕</button>
    {/if}
  </header>

  {#if row.instances.length > 1}
    <div class="instances" role="group" aria-label={t('instance')}>
      {#each row.instances as inst (inst.index)}
        <button
          class="pill mono"
          aria-pressed={inst.index === instance?.index}
          onclick={() => (chosen = inst.index)}
        >
          {inst.item.label ?? inst.item.ver ?? '—'}
          <StatusChip status={inst.status.status} cvss={inst.status.maxCvss} />
        </button>
      {/each}
    </div>
  {/if}

  {#if s && product}
    <div class="versionbox">
      <div class="col">
        <span class="muted">{t('youHave')}</span>
        <span class="mono big">{s.installed ?? '—'}</span>
      </div>
      {#if s.latest && s.newer.length > 0}
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
          ><path d="M5 12h14M13 6l6 6-6 6" /></svg
        >
        <div class="col">
          <span class="muted">{t('latest')}</span>
          <span class="mono big">{s.latest}</span>
        </div>
      {/if}
      <span class="grow"></span>
      {#if s.newer.length > 0 && s.installed}
        <button class="done" onclick={markUpdated}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
            ><path d="M5 12.5l4.5 4.5L19 7.5" /></svg
          >
          {t('iUpdated')}
        </button>
      {/if}
    </div>

    {#if product.tracks.length > 0}
      <label class="field">
        <span class="muted">{t('following')}</span>
        <select value={instance?.item.track ?? s.track} onchange={(e) => setTrack(e.currentTarget.value)}>
          <option value="latest">{t('trackLatest')}</option>
          {#each product.tracks as track (track.id)}
            <option value={track.id}>{track.id}{track.label ? ` (${track.label})` : ''}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#snippet note(text: string, tone: 'warn' | 'info' = 'warn')}
      <div class="note {tone}" role="status">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
          ><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></svg
        >
        <span>{text}</span>
      </div>
    {/snippet}
    {#if s.status === 'eol' && s.branch}
      {@render note(
        t('noteEol', {
          branch: s.branch.id,
          date: s.branch.eolDate ? ` (${formatDate(s.branch.eolDate, locale)})` : '',
        }),
      )}
    {/if}
    {#if s.flags.includes('eolSoon') && s.branch?.eolDate}
      {@render note(t('noteEolSoon', { branch: s.branch.id, date: formatDate(s.branch.eolDate, locale) }))}
    {/if}
    {#if s.newestOverall}{@render note(t('noteNewMajor', { version: s.newestOverall }), 'info')}{/if}
    {#if s.flags.includes('staleData')}{@render note(t('noteStale'))}{/if}
    {#if entry && !entry.hasSecuritySource}{@render note(t('noteNoSecurity'), 'info')}{/if}
    {#if !s.installed}{@render note(t('noteNoVersion'), 'info')}{/if}

    {#if s.newer.length > 0}
      <div class="counts">
        {#each TYPES as type (type)}
          <div class="count">
            <span class="n">{s.counts[type]}</span>
            <TypeChip {type} />
          </div>
        {/each}
      </div>
    {/if}

    <label class="field">
      <span class="muted">{t('myVersion')}</span>
      <input
        class="mono"
        list="versions-{row.id}"
        value={versionInput}
        placeholder={t('versionPlaceholder', { example: s.latest ?? '1.0.0' })}
        oninput={(e) => (draft = e.currentTarget.value)}
        onchange={commitVersion}
        onkeydown={(e) => e.key === 'Enter' && commitVersion()}
        aria-invalid={versionError !== '' && !s.flags.includes('unknownVersion')}
      />
      <datalist id="versions-{row.id}">
        {#each releasesForPicker as r (r.sortKey)}<option value={r.version}></option>{/each}
      </datalist>
      {#if versionError}<span class="hint">{versionError}</span>{/if}
    </label>

    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'changes'} onclick={() => (tab = 'changes')}>
        {t('tabChanges', { n: s.newer.length })}
      </button>
      <button role="tab" aria-selected={tab === 'vulns'} onclick={() => (tab = 'vulns')}>
        {t('tabVulns', { n: s.affecting.length })}
      </button>
      <button role="tab" aria-selected={tab === 'module'} onclick={() => (tab = 'module')}
        >{t('tabModule')}</button
      >
      <span class="grow"></span>
      {#if tab === 'changes' && s.newer.length > 0}
        <label class="toggle">
          <input type="checkbox" bind:checked={importantOnly} />
          {t('importantOnly')}
        </label>
      {/if}
    </div>

    <div role="tabpanel" class="tabpanel">
      {#if tab === 'changes'}
        {#if !s.installed}
          <h3 class="muted">{t('recentReleases')}</h3>
          {#each recent as r (r.sortKey)}{@render release(r)}{/each}
        {:else if s.newer.length === 0}
          <div class="good">{t('upToDate')}</div>
        {:else}
          {#each s.newer as r (r.sortKey)}{@render release(r)}{/each}
          <div class="divider"><span>{t('yourVersion', { version: s.installed })}</span></div>
        {/if}
      {:else if tab === 'vulns'}
        {#if s.affecting.length === 0}
          <div class="good">{entry?.hasSecuritySource === false ? t('noVulnSource') : t('noVulns')}</div>
        {:else}
          {#each s.affecting as adv (adv.id)}
            <article class="vuln">
              <span class="score">{adv.cvss ? adv.cvss.score.toFixed(1) : adv.severity}</span>
              <div class="col">
                <a href={adv.url} target="_blank" rel="noreferrer" class="mono">{adv.id}</a>
                <span>{adv.title}</span>
                <span class="muted">
                  {#if adv.kev}<strong>KEV</strong> ·{/if}
                  {#if fixedIn(adv.affected)}{t('fixedIn', { version: fixedIn(adv.affected) ?? '' })}{/if}
                </span>
              </div>
            </article>
          {/each}
        {/if}
      {:else}
        <dl class="module">
          <dt>{t('sources')}</dt>
          <dd>
            {#each product.sources as source (source.url)}
              <div>
                <span class="mono muted">{source.type}</span>
                <a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
              </div>
            {/each}
          </dd>
          {#if product.tracks.length > 0}
            <dt>{t('tracks')}</dt>
            <dd class="mono">{product.tracks.map((tr) => tr.id).join(', ')}</dd>
          {/if}
          {#if product.branches.length > 0}
            <dt>{t('lifecycle')}</dt>
            <dd>
              <table>
                <thead><tr><th>{t('branch')}</th><th>{t('latest')}</th><th>{t('eolDate')}</th></tr></thead>
                <tbody>
                  {#each product.branches.slice(0, 12) as b (b.id)}
                    <tr class:ended={b.eol}>
                      <td class="mono">{b.id}{b.codename ? ` (${b.codename})` : ''}</td>
                      <td class="mono">{b.latest ?? '—'}</td>
                      <td
                        >{b.eolDate ? formatDate(b.eolDate, locale) : '—'} · {b.eol
                          ? t('ended')
                          : t('maintained')}</td
                      >
                    </tr>
                  {/each}
                </tbody>
              </table>
            </dd>
          {/if}
        </dl>
        <a href="{REPO_URL}/blob/main/products/{row.id}.yaml" target="_blank" rel="noreferrer"
          >{t('editModule')}</a
        >
      {/if}
    </div>
  {/if}

  {#snippet release(r: Release)}
    {@const items = importantOnly ? r.items.filter((i) => IMPORTANT.has(i.type)) : r.items}
    <article class="release">
      <header>
        {#if r.url}<a class="mono ver" href={r.url} target="_blank" rel="noreferrer">{r.version}</a
          >{:else}<span class="mono ver">{r.version}</span>{/if}
        <span class="muted">{formatDate(r.date ?? r.firstSeenAt, locale)}</span>
        {#if isThisWeek(r)}<span class="badge">{t('thisWeek')}</span>{/if}
        <span class="line"></span>
      </header>
      {#each items as item, i (i)}
        <div class="item {item.type}">
          <TypeChip type={item.type} />
          <div class="col">
            <span>{item.text}</span>
            {#if item.refs?.length}<span class="mono refs">{item.refs.join(', ')}</span>{/if}
          </div>
        </div>
      {/each}
      {#if importantOnly && items.length < r.items.length}
        <span class="muted small">{t('hiddenItems', { n: r.items.length - items.length })}</span>
      {/if}
      {#if r.moreItems}<span class="muted small">{t('moreItems', { n: r.moreItems })}</span>{/if}
    </article>
  {/snippet}

  <button class="remove" onclick={() => instance && inventory.remove(instance.index)}
    >{t('removeFromBoard')}</button
  >
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 24px;
    border-radius: 16px;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
  }
  .grow {
    flex-grow: 1;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  .small {
    font-size: 13px;
  }
  .icon {
    font-size: 18px;
    padding: 4px 8px;
    border-radius: 8px;
  }
  .instances {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 10px;
    border-radius: 8px;
    font-size: 13px;
    border: 1px solid var(--border-strong);
  }
  .pill[aria-pressed='true'] {
    border-color: var(--text);
  }
  .versionbox {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    padding: 18px 20px;
    border-radius: 12px;
    background: var(--surface-3);
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .big {
    font-size: 22px;
    font-weight: 600;
  }
  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .done {
    height: 44px;
    padding: 0 16px;
    border-radius: 10px;
    background: var(--ok);
    color: var(--on-ok);
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .done svg {
    color: inherit;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  input,
  select {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 8px 10px;
    max-width: 320px;
  }
  input[aria-invalid='true'] {
    border-color: var(--critical);
  }
  .hint {
    font-size: 13px;
    color: var(--text-muted);
  }
  .note {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 10px;
    font-size: 14px;
    line-height: 1.5;
    background: var(--update-bg);
    border: 1px solid var(--update-border);
  }
  .note svg {
    color: var(--update);
    margin-top: 1px;
  }
  .note.info {
    background: var(--surface-3);
    border-color: var(--border);
  }
  .note.info svg {
    color: var(--text-muted);
  }
  .counts {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
  .count {
    padding: 10px;
    border-radius: 10px;
    background: var(--surface-3);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .count :global(.type) {
    min-width: 0;
    align-self: flex-start;
    font-size: 10px;
  }
  .n {
    font-size: 20px;
    font-weight: 600;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  [role='tab'] {
    padding: 10px 14px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  [role='tab'][aria-selected='true'] {
    color: var(--text);
    border-bottom-color: var(--text);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-soft);
  }
  .tabpanel {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .good {
    padding: 18px;
    border-radius: 12px;
    background: var(--ok-bg);
    border: 1px solid var(--ok-border);
    font-size: 14px;
  }
  .release {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .release header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ver {
    font-size: 16px;
    font-weight: 600;
  }
  .line {
    flex-grow: 1;
    height: 1px;
    background: var(--border);
  }
  .badge {
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--stale-border);
    font-size: 11px;
  }
  .item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface-3);
    font-size: 14px;
    line-height: 1.5;
  }
  .item.security {
    background: var(--critical-bg);
  }
  .refs {
    font-size: 12px;
    color: var(--critical);
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text-muted);
    font-size: 13px;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex-grow: 1;
    height: 1px;
    background: var(--border-strong);
  }
  .vuln {
    display: flex;
    gap: 14px;
    padding: 12px;
    border-radius: 10px;
    background: var(--critical-bg);
    border: 1px solid var(--critical-border);
  }
  .score {
    font-size: 20px;
    font-weight: 700;
    color: var(--critical);
    min-width: 48px;
  }
  .module {
    margin: 0;
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 10px 16px;
    font-size: 14px;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    word-break: break-all;
  }
  table {
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    text-align: left;
    padding: 4px 12px 4px 0;
  }
  th {
    color: var(--text-muted);
    font-weight: 500;
  }
  tr.ended {
    color: var(--text-muted);
  }
  .remove {
    align-self: flex-start;
    font-size: 13px;
    color: var(--text-muted);
    text-decoration: underline;
  }
  @media (max-width: 720px) {
    .panel {
      padding: 16px;
      border-radius: 0;
    }
    .counts {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
