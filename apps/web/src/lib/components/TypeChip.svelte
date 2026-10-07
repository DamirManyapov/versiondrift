<script lang="ts">
  import type { ItemType } from '@versiondrift/schema';
  import { i18n } from '$lib/i18n/context';

  let { type }: { type: ItemType } = $props();
  const { t } = $derived(i18n());
  const KEYS = {
    security: 'typeSecurity',
    breaking: 'typeBreaking',
    deprecated: 'typeDeprecated',
    feature: 'typeFeature',
    fix: 'typeFix',
    other: 'typeOther',
  } as const;
</script>

<span class="mono type {type}">{t(KEYS[type])}</span>

<style>
  /* Change types are neutral tags; only security (red) and breaking (amber) carry colour (UI audit, board 5). */
  .type {
    flex-shrink: 0;
    display: inline-block;
    min-width: 96px;
    text-align: center;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-soft);
    background: var(--surface-3);
  }
  .security {
    background: var(--type-security);
    border-color: var(--type-security);
    color: var(--on-type);
  }
  .breaking {
    background: var(--update-bg);
    border-color: var(--update-border);
    color: var(--update);
  }
</style>
