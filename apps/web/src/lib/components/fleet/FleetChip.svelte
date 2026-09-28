<script lang="ts">
  // A status chip of the fleet screens: tinted with a dot; no connection, waiting and unknown are dashed and hollow.
  import type { FleetStatus } from '@versiondrift/core';

  let {
    status,
    label,
    size = 'sm',
  }: { status: FleetStatus | 'stale'; label: string; size?: 'sm' | 'md' } = $props();
</script>

<span class="chip {status} {size}">{label}</span>

<style>
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
  .stale,
  .pending,
  .unknown {
    color: var(--text-muted);
    background: transparent;
    border-color: var(--stale-border);
    border-style: dashed;
  }
  .stale::before,
  .pending::before,
  .unknown::before {
    background: transparent;
    border: 1.5px solid currentColor;
    box-sizing: border-box;
  }
</style>
