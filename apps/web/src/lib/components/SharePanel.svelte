<script lang="ts">
  // "Share" on the board (S4-T1): a /b#… link that carries the board in its fragment.
  import { copyText } from '$lib/clipboard';
  import { resolve } from '$app/paths';
  import { i18n } from '$lib/i18n/context';
  import type { InventoryItem } from '$lib/inventory/model';
  import { encodeShare } from '$lib/inventory/share';

  let {
    items,
    onclose,
    ontoast,
  }: { items: InventoryItem[]; onclose: () => void; ontoast: (message: string) => void } = $props();

  const { t } = $derived(i18n());
  let labels = $state(false);
  let url = $state('');
  const hasLabels = $derived(items.some((i) => i.label));

  $effect(() => {
    const list = $state.snapshot(items);
    const withLabels = labels;
    let current = true;
    void encodeShare(list, { labels: withLabels }).then((fragment) => {
      if (current) url = `${location.origin}${resolve('/b')}#${fragment}`;
    });
    return () => {
      current = false;
    };
  });

  async function copy() {
    await copyText(url);
    ontoast(t('shareCopied'));
  }
</script>

<section class="share" aria-labelledby="share-title">
  <header>
    <h2 id="share-title">{t('shareTitle')}</h2>
    <button type="button" class="btn btn-sm btn-ghost btn-icon" onclick={onclose} aria-label={t('closePanel')}
      >✕</button
    >
  </header>
  <p class="muted">{t('shareNote')}</p>
  <div class="row">
    <input
      class="mono"
      readonly
      value={url}
      aria-label={t('shareLink')}
      onfocus={(e) => e.currentTarget.select()}
    />
    <button type="button" class="btn btn-primary" onclick={copy} disabled={url === ''}
      >{t('shareCopy')}</button
    >
  </div>
  {#if hasLabels}
    <label class="toggle"><input type="checkbox" bind:checked={labels} /> {t('shareLabels')}</label>
  {/if}
  <p class="muted">
    <a href={resolve('/rss/b/[ids].xml', { ids: [...new Set(items.map((i) => i.p))].join(',') })}
      >{t('rssBoard')}</a
    >
    · {t('rssBoardNote')}
  </p>
</section>

<style>
  .share {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    margin-bottom: 16px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--text-muted);
    font-size: 13px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  input[readonly] {
    flex: 1;
    min-width: 0;
    height: var(--control-h);
    font-size: 13px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 0 10px;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-soft);
  }
</style>
