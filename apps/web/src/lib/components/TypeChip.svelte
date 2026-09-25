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
  .type {
    flex-shrink: 0;
    display: inline-block;
    min-width: 96px;
    text-align: center;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--on-type);
  }
  .security {
    background: var(--type-security);
  }
  .breaking {
    background: var(--type-breaking);
  }
  .deprecated {
    background: var(--type-deprecated);
  }
  .feature {
    background: var(--type-feature);
  }
  .fix {
    background: var(--type-fix);
    color: var(--on-type-fix);
  }
  .other {
    background: var(--type-other);
    color: var(--on-type-fix);
  }
</style>
