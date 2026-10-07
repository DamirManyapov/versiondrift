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
  /* One badge per status level across the app (UI audit, board 2): a light tone, its border and a dot — the same as
     the fleet chips. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
  }
  .chip::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
  .md {
    padding: 5px 12px;
    font-size: 13px;
  }
  .critical {
    color: var(--critical);
    background: var(--critical-bg);
    border-color: var(--critical-border);
  }
  .eol {
    color: var(--eol);
    background: var(--eol-bg);
    border-color: var(--eol-border);
  }
  .update {
    color: var(--update);
    background: var(--update-bg);
    border-color: var(--update-border);
  }
  .ok {
    color: var(--ok);
    background: var(--ok-bg);
    border-color: var(--ok-border);
  }
  .news,
  .stale {
    color: var(--text-soft);
    background: var(--surface-3);
    border-color: var(--news-border);
  }
  .news::before {
    display: none;
  }
  .stale {
    color: var(--text-muted);
    background: transparent;
    border-color: var(--stale-border);
    border-style: dashed;
  }
  .stale::before {
    background: transparent;
    border: 1.5px solid currentColor;
    box-sizing: border-box;
  }
</style>
