<script lang="ts">
  import { i18n } from '$lib/i18n/context';

  let { message, undo, onclose }: { message: string; undo?: (() => void) | undefined; onclose: () => void } =
    $props();
  const { t } = $derived(i18n());

  $effect(() => {
    const timer = setTimeout(onclose, 8000);
    return () => clearTimeout(timer);
  });
</script>

<div class="toast" role="status">
  <span>{message}</span>
  {#if undo}
    <button
      onclick={() => {
        undo?.();
        onclose();
      }}>{t('undo')}</button
    >
  {/if}
</div>

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--text);
    color: var(--bg);
    font-size: 14px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
    max-width: calc(100vw - 32px);
  }
  button {
    font-weight: 600;
    text-decoration: underline;
  }
</style>
