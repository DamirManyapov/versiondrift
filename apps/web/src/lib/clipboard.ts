// Copying text. navigator.clipboard exists only in secure contexts (https, localhost); a self-hosted instance opened as
// http://192.168.1.10:8080 falls back to a hidden textarea and the copy command, which still works there.
export async function copyText(text: string): Promise<void> {
  const { clipboard } = navigator as { clipboard?: Clipboard };
  if (clipboard && window.isSecureContext) {
    await clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  // Inside a modal dialog everything else is inert: the textarea must live in the dialog to be selected.
  (document.activeElement?.closest('dialog') ?? document.body).append(area);
  area.select();
  // Deprecated, but the only copy that works outside secure contexts.
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('The browser refused to copy');
}
