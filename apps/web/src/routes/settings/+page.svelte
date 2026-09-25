<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import BoardsManager from '$lib/components/BoardsManager.svelte';
  import NotificationsManager from '$lib/components/NotificationsManager.svelte';
  import { i18n } from '$lib/i18n/context';
  import { fromYaml, InventoryImportError, toYaml, type InventoryItem } from '$lib/inventory/model';
  import { inventory } from '$lib/inventory/state.svelte';

  const { t } = $derived(i18n());
  let pending = $state<InventoryItem[] | undefined>();
  let message = $state<string | undefined>();

  onMount(() => inventory.init());

  function exportYaml() {
    const blob = new Blob([toYaml(inventory.data)], { type: 'application/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory.yaml';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function readFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      pending = fromYaml(await file.text());
      message = undefined;
    } catch (error) {
      pending = undefined;
      message = t('importFailed', {
        message: error instanceof InventoryImportError ? error.message : String(error),
      });
    }
    event.currentTarget.value = '';
  }

  function apply(mode: 'replace' | 'add') {
    if (!pending) return;
    const base = mode === 'replace' || inventory.demo ? [] : inventory.data.items;
    inventory.replaceItems([...base, ...pending]);
    message = t('importedItems', { n: pending.length });
    pending = undefined;
  }
</script>

<svelte:head><title>{t('settingsTitle')} · VersionDrift</title></svelte:head>

<div class="page">
  <h1>{t('settingsTitle')}</h1>

  {#if inventory.mode === 'selfhosted'}<BoardsManager />{/if}
  {#if inventory.mode === 'selfhosted' && page.data.account?.role !== 'viewer'}<NotificationsManager />{/if}

  <section>
    <h2><label for="cvss">{t('settingsThreshold')}</label></h2>
    <p class="muted">{t('settingsThresholdHelp')}</p>
    <input
      id="cvss"
      type="number"
      min="0"
      max="10"
      step="0.1"
      value={inventory.data.settings.criticalCvss}
      onchange={(e) => {
        const value = Number(e.currentTarget.value);
        if (value >= 0 && value <= 10) inventory.setSettings({ criticalCvss: value });
      }}
    />
  </section>

  <section>
    <h2>{t('settingsInventory')}</h2>
    <p class="muted">{inventory.mode === 'selfhosted' ? t('settingsStorageServer') : t('settingsStorage')}</p>
    <div class="row">
      <button class="primary" onclick={exportYaml} disabled={inventory.data.items.length === 0}
        >{t('exportYaml')}</button
      >
      <label class="ghost">
        {t('importYaml')}
        <input
          type="file"
          accept=".yaml,.yml,text/yaml,application/yaml"
          onchange={readFile}
          class="visually-hidden"
        />
      </label>
      <button
        class="ghost danger"
        onclick={() => {
          inventory.startOwn();
          message = t('clearedBoard');
        }}>{t('clearBoard')}</button
      >
    </div>
    {#if pending}
      <div class="confirm" role="status">
        <span>{t('importedItems', { n: pending.length }).replace(/\.$/, '')}?</span>
        <button class="primary" onclick={() => apply('replace')}>{t('importReplace')}</button>
        <button class="ghost" onclick={() => apply('add')}>{t('importAdd')}</button>
      </div>
    {/if}
    {#if message}<p role="status">{message}</p>{/if}
  </section>
</div>

<style>
  .page {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  h1 {
    margin: 0;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 18px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .muted {
    color: var(--text-muted);
    font-size: 14px;
    margin: 0;
  }
  input[type='number'] {
    font: inherit;
    width: 100px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .row,
  .confirm {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  .confirm {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .primary,
  .ghost {
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    background: var(--text);
    color: var(--bg);
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .ghost {
    border: 1px solid var(--border-strong);
  }
  .ghost:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .danger {
    color: var(--critical);
  }
</style>
