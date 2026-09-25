// Where alerts go (docs/07 "Notifications"): Telegram, ntfy, Gotify, a signed webhook, or e-mail over SMTP.
// Messages are composed as Telegram-flavoured HTML (<b>, <a>); other channels get plain text or a small HTML mail.
import { createHmac } from 'node:crypto';
import { createTransport } from 'nodemailer';
import { splitMessage, telegram } from './telegram.ts';

export type ChannelConfig =
  | { kind: 'telegram'; token: string; chatId: string }
  | { kind: 'ntfy'; server?: string; topic: string; token?: string }
  | { kind: 'gotify'; server: string; token: string }
  | { kind: 'webhook'; url: string; secret?: string }
  | {
      kind: 'email';
      host: string;
      port: number;
      /** TLS from the start (465); otherwise STARTTLS when the server offers it. */
      secure: boolean;
      user?: string;
      password?: string;
      from: string;
      to: string;
    };

export type ChannelKind = ChannelConfig['kind'];
export const CHANNEL_KINDS: ChannelKind[] = ['telegram', 'ntfy', 'gotify', 'webhook', 'email'];

export interface AlertMessage {
  title: string;
  /** Telegram-flavoured HTML. */
  html: string;
  /** The same as plain text, links written out. */
  text: string;
}

export interface Channel {
  send(message: AlertMessage): Promise<void>;
}

const unescape = (s: string) =>
  s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&');

/** "<b>Grafana</b> · <a href="u">notes</a>" → "Grafana · notes (u)". */
export function htmlToText(html: string): string {
  return unescape(
    html
      .replace(
        /<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/g,
        (_, href: string, label: string) => `${label} (${href})`,
      )
      .replace(/<[^>]+>/g, ''),
  );
}

export const alertMessage = (html: string, title = 'VersionDrift'): AlertMessage => ({
  title,
  html,
  text: htmlToText(html),
});

async function ok(response: Response, what: string): Promise<void> {
  if (response.ok) return;
  const detail = (await response.text().catch(() => '')).slice(0, 200);
  throw new Error(`${what}: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
}

export interface ChannelDeps {
  fetch?: typeof fetch;
  /** For tests: replaces the SMTP transport. */
  mailer?: { sendMail(mail: Record<string, unknown>): Promise<unknown> };
}

export function channel(config: ChannelConfig, deps: ChannelDeps = {}): Channel {
  const doFetch = deps.fetch ?? fetch;
  switch (config.kind) {
    case 'telegram': {
      const bot = telegram(config.token, config.chatId, doFetch);
      return { send: (m) => bot.send(m.html) };
    }
    case 'ntfy':
      return {
        async send(m) {
          const server = (config.server || 'https://ntfy.sh').replace(/\/+$/, '');
          for (const part of splitMessage(m.text)) {
            await ok(
              await doFetch(`${server}/${encodeURIComponent(config.topic)}`, {
                method: 'POST',
                headers: {
                  title: m.title,
                  ...(config.token && { authorization: `Bearer ${config.token}` }),
                },
                body: part,
              }),
              'ntfy',
            );
          }
        },
      };
    case 'gotify':
      return {
        async send(m) {
          await ok(
            await doFetch(`${config.server.replace(/\/+$/, '')}/message`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-gotify-key': config.token },
              body: JSON.stringify({ title: m.title, message: m.text, priority: 5 }),
            }),
            'Gotify',
          );
        },
      };
    case 'webhook':
      return {
        async send(m) {
          const body = JSON.stringify({ source: 'versiondrift', title: m.title, text: m.text, html: m.html });
          const headers: Record<string, string> = { 'content-type': 'application/json' };
          if (config.secret)
            headers['x-versiondrift-signature'] =
              `sha256=${createHmac('sha256', config.secret).update(body).digest('hex')}`;
          await ok(
            await doFetch(config.url, {
              method: 'POST',
              headers,
              body,
            }),
            'webhook',
          );
        },
      };
    case 'email': {
      const mailer =
        deps.mailer ??
        createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          ...(config.user && { auth: { user: config.user, pass: config.password ?? '' } }),
        });
      return {
        async send(m) {
          await mailer.sendMail({
            from: config.from,
            to: config.to,
            subject: m.title,
            text: m.text,
            html: `<div style="font-family:sans-serif;white-space:pre-wrap">${m.html}</div>`,
          });
        },
      };
    }
  }
}
