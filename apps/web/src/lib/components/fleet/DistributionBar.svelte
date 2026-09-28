<script lang="ts">
  // Hosts of a product by status: solid segments, "no connection" dashed and hollow; the text says the same.
  import { AGGREGATE_KEYS, type AggregateKey } from '@versiondrift/core';

  let { counts, label }: { counts: Record<AggregateKey, number>; label: string } = $props();
  const order: AggregateKey[] = ['critical', 'eol', 'update', 'unknown', 'ok', 'stale'];
  const segments = $derived(order.filter((k) => AGGREGATE_KEYS.includes(k) && counts[k] > 0));
</script>

<div class="bar" role="img" aria-label={label}>
  {#each segments as key (key)}<span class={key} style="flex: {counts[key]}"></span>{/each}
</div>

<style>
  .bar {
    display: flex;
    gap: 3px;
    height: 8px;
  }
  span {
    border-radius: 3px;
    min-width: 6px;
  }
  .critical {
    background: var(--critical);
  }
  .eol {
    background: var(--eol);
  }
  .update {
    background: var(--update);
  }
  .ok {
    background: var(--ok);
  }
  .unknown,
  .stale {
    border: 1px dashed var(--stale-border);
  }
</style>
