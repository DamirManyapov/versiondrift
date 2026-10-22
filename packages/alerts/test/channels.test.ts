import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { alertMessage, channel, htmlToMarkdown, htmlToText } from '../src/index.ts';

const message = alertMessage(
  '🟥 <b>Grafana</b> 12.0.0 → 12.1.1 · <a href="https://example.com/n?a=1&amp;b=2">notes</a>\nCVE-2026-1 &lt;x&gt;',
  'VersionDrift: Grafana',
);

function recorder() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn((url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response('{}'));
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe('alert channels', () => {
  it('turn Telegram HTML into plain text for the others', () => {
    expect(htmlToText(message.html)).toBe(
      '🟥 Grafana 12.0.0 → 12.1.1 · notes (https://example.com/n?a=1&b=2)\nCVE-2026-1 <x>',
    );
  });

  it('telegram sends HTML to the bot API', async () => {
    const r = recorder();
    await channel({ kind: 'telegram', token: 'T', chatId: '42' }, { fetch: r.fetch }).send(message);
    expect(r.calls[0]?.url).toBe('https://api.telegram.org/botT/sendMessage');
    expect(JSON.parse(r.calls[0]?.init.body as string)).toMatchObject({ chat_id: '42', parse_mode: 'HTML' });
  });

  it('mattermost posts Markdown to the incoming webhook, with a channel when given', async () => {
    expect(htmlToMarkdown(message.html)).toBe(
      '🟥 **Grafana** 12.0.0 → 12.1.1 · [notes](https://example.com/n?a=1&b=2)\nCVE-2026-1 <x>',
    );
    const r = recorder();
    await channel(
      { kind: 'mattermost', url: 'https://mm.example.com/hooks/abc', channel: 'ops-alerts' },
      { fetch: r.fetch },
    ).send(message);
    expect(r.calls[0]?.url).toBe('https://mm.example.com/hooks/abc');
    expect(JSON.parse(r.calls[0]?.init.body as string)).toEqual({
      text: '🟥 **Grafana** 12.0.0 → 12.1.1 · [notes](https://example.com/n?a=1&b=2)\nCVE-2026-1 <x>',
      username: 'VersionDrift',
      channel: 'ops-alerts',
    });
  });

  it('ntfy posts text with a title, to ntfy.sh unless a server is given', async () => {
    const r = recorder();
    await channel({ kind: 'ntfy', topic: 'my stack', token: 'tk' }, { fetch: r.fetch }).send(message);
    expect(r.calls[0]?.url).toBe('https://ntfy.sh/my%20stack');
    expect(r.calls[0]?.init.headers).toMatchObject({
      title: 'VersionDrift: Grafana',
      authorization: 'Bearer tk',
    });
    expect(r.calls[0]?.init.body).toBe(message.text);
  });

  it('gotify posts JSON with the app token', async () => {
    const r = recorder();
    await channel({ kind: 'gotify', server: 'https://push.lan/', token: 'app' }, { fetch: r.fetch }).send(
      message,
    );
    expect(r.calls[0]?.url).toBe('https://push.lan/message');
    expect(r.calls[0]?.init.headers).toMatchObject({ 'x-gotify-key': 'app' });
  });

  it('webhook signs the body with HMAC-SHA256 when a secret is set', async () => {
    const r = recorder();
    await channel({ kind: 'webhook', url: 'https://hooks.lan/vd', secret: 's3' }, { fetch: r.fetch }).send(
      message,
    );
    const body = r.calls[0]?.init.body as string;
    expect(JSON.parse(body)).toMatchObject({ source: 'versiondrift', text: message.text });
    expect(r.calls[0]?.init.headers).toMatchObject({
      'x-versiondrift-signature': `sha256=${createHmac('sha256', 's3').update(body).digest('hex')}`,
    });
  });

  it('e-mail sends text and HTML parts', async () => {
    const sendMail = vi.fn(() => Promise.resolve({}));
    const mail = channel(
      { kind: 'email', host: 'smtp.lan', port: 587, secure: false, from: 'vd@lan', to: 'ops@lan' },
      { mailer: { sendMail } },
    );
    await mail.send(message);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@lan', subject: 'VersionDrift: Grafana', text: message.text }),
    );
  });

  it('reports a failed delivery with the status and the start of the answer', async () => {
    const fetch = (() =>
      Promise.resolve(new Response('bad topic', { status: 400 }))) as typeof globalThis.fetch;
    await expect(channel({ kind: 'ntfy', topic: 'x' }, { fetch }).send(message)).rejects.toThrow(
      'ntfy: HTTP 400 bad topic',
    );
  });
});
