// Telegram Bot API: sendMessage with HTML formatting, split to stay under the 4096-character limit.
export interface Messenger {
  send(html: string): Promise<void>;
}

export const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const LIMIT = 4000;

export function splitMessage(text: string): string[] {
  if (text.length <= LIMIT) return [text];
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > LIMIT) {
      parts.push(current);
      current = '';
    }
    current = current ? `${current}\n${line.slice(0, LIMIT)}` : line.slice(0, LIMIT);
  }
  if (current) parts.push(current);
  return parts;
}

export function telegram(token: string, chatId: string, doFetch: typeof fetch = fetch): Messenger {
  return {
    async send(html) {
      for (const part of splitMessage(html)) {
        const response = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: part,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          }),
        });
        if (!response.ok) {
          const detail =
            ((await response.json().catch(() => ({}))) as { description?: string }).description ?? '';
          throw new Error(`Telegram sendMessage failed: HTTP ${response.status} ${detail}`);
        }
      }
    },
  };
}
