<script lang="ts">
  import type { Status } from '@versiondrift/core';
  import { i18n } from '$lib/i18n/context';

  let {
    status,
    cvss,
    size = 'sm',
  }: { status: Status; cvss?: number | undefined; size?: 'sm' | 'md' } = $props();
  const { t } = $derived(i18n());
  const KEYS = {
    critical: 'statusCritical',
    eol: 'statusEol',
    update: 'statusUpdate',
    ok: 'statusOk',
    news: 'statusNews',
    stale: 'statusStale',
  } as const;
  const label = $derived(
    status === 'critical' && cvss !== undefined ? `CVSS ${cvss.toFixed(1)}` : t(KEYS[status]),
  );
</script>

<span class="chip {status} {size}">{label}</span>

<style>
  .chip {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    line-height: 1.3;
  }
  .md {
    padding: 6px 10px;
    border-radius: 8px;
    font-size: 13px;
  }
  .critical {
    background: var(--critical);
    color: var(--on-critical);
  }
  .eol {
    background: var(--eol);
    color: var(--on-eol);
  }
  .update {
    background: var(--update);
    color: var(--on-update);
  }
  .ok {
    background: var(--ok);
    color: var(--on-ok);
  }
  .news,
  .stale {
    background: var(--surface-3);
    color: var(--text-soft);
    border: 1px solid var(--news-border);
  }
  .stale {
    border-style: dashed;
  }
</style>
