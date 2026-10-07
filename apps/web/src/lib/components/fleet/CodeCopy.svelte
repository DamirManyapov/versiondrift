<script lang="ts">
  // A command to copy: the code, and a button that copies it (or selects it when the clipboard is refused).
  import { copyText } from '$lib/clipboard';
  import { i18n } from '$lib/i18n/context';

  let { code }: { code: string } = $props();
  const { t } = $derived(i18n());
  let copied = $state(false);
  let pre: HTMLElement;

  async function copy() {
    try {
      await copyText(code);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }
</script>

<div class="code">
  <pre bind:this={pre}><code>{code}</code></pre>
  <button class="btn btn-sm copy" onclick={() => void copy()}>{copied ? t('copiedShort') : t('copy')}</button>
</div>

<style>
  .code {
    position: relative;
    margin: 6px 0 0;
  }
  pre {
    margin: 0;
    padding: 12px 90px 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.55;
    overflow-x: auto;
    white-space: pre;
  }
  .copy {
    position: absolute;
    top: 6px;
    right: 6px;
  }
</style>
