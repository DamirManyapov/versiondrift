// The notification channels API's validation and redaction: secrets go in, never out.
import { error } from '@sveltejs/kit';
import { ALERT_EVENTS, type ChannelInput, type ChannelRecord } from '@versiondrift/db';
import { z } from 'zod';

/** Credential fields per kind; the API reports whether they are set, not their values. */
export const SECRET_FIELDS: Record<ChannelRecord['kind'], string[]> = {
  telegram: ['token'],
  // The incoming webhook URL carries its token: write-only like a password.
  mattermost: ['url'],
  ntfy: ['token'],
  gotify: ['token'],
  webhook: ['secret'],
  email: ['password'],
};

const text = z.string().trim();
const url = text.pipe(z.url({ protocol: /^https?$/ }));

const CONFIG = {
  telegram: z.object({ token: text.min(1), chatId: text.min(1) }),
  mattermost: z.object({ url, channel: text.optional() }),
  ntfy: z.object({
    server: z.union([url, z.literal('')]).optional(),
    topic: text.min(1),
    token: text.optional(),
  }),
  gotify: z.object({ server: url, token: text.min(1) }),
  webhook: z.object({ url, secret: text.optional() }),
  email: z.object({
    host: text.min(1),
    port: z.coerce.number().int().min(1).max(65535),
    secure: z.boolean(),
    user: text.optional(),
    password: z.string().optional(),
    from: text.min(3),
    to: text.min(3),
  }),
} as const;

const Common = z.object({
  name: text.min(1).max(60),
  events: z.array(z.enum(ALERT_EVENTS)),
  lang: z.enum(['en', 'ru']),
  digestDay: z.number().int().min(0).max(6).nullable(),
  enabled: z.boolean().optional(),
});

const Kind = z.enum(['telegram', 'mattermost', 'ntfy', 'gotify', 'webhook', 'email']);

/** Drops empty optional strings so they don't end up as settings. */
const compact = (config: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(config).filter(([, v]) => v !== '' && v !== undefined));

function fail(issues: z.core.$ZodIssue[]): never {
  const issue = issues[0];
  error(400, `${issue?.path.join('.') || 'input'}: ${issue?.message ?? 'invalid'}`);
}

/** A new channel from a request body. */
export function parseNew(body: unknown): ChannelInput {
  const input = body as { kind?: unknown; config?: unknown };
  const kind = Kind.safeParse(input?.kind);
  if (!kind.success) fail(kind.error.issues);
  const common = Common.safeParse(body);
  if (!common.success) fail(common.error.issues);
  const config = CONFIG[kind.data].safeParse(input.config);
  if (!config.success) fail(config.error.issues.map((i) => ({ ...i, path: ['config', ...i.path] })));
  return { ...common.data, kind: kind.data, config: compact(config.data) };
}

/** A change to an existing channel; empty secret fields keep the stored value. */
export function parsePatch(body: unknown, current: ChannelRecord): Partial<ChannelInput> {
  const input = body as { config?: Record<string, unknown> };
  const common = Common.partial().safeParse(body);
  if (!common.success) fail(common.error.issues);
  if (!input?.config) return common.data;
  const merged: Record<string, unknown> = { ...current.config, ...input.config };
  for (const field of SECRET_FIELDS[current.kind])
    if (input.config[field] === '' || input.config[field] === undefined)
      merged[field] = current.config[field];
  const config = CONFIG[current.kind].safeParse(merged);
  if (!config.success) fail(config.error.issues.map((i) => ({ ...i, path: ['config', ...i.path] })));
  return { ...common.data, config: compact(config.data) };
}

/** What the browser sees: settings without credentials, and which credentials are set. */
export function redact(record: ChannelRecord) {
  const config = { ...record.config };
  const secrets: string[] = [];
  for (const field of SECRET_FIELDS[record.kind]) {
    if (config[field]) secrets.push(field);
    delete config[field];
  }
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    config,
    secrets,
    events: record.events,
    lang: record.lang,
    digestDay: record.digestDay,
    enabled: record.enabled,
    lastSentAt: record.lastSentAt,
    lastError: record.lastError,
  };
}

export type PublicChannel = ReturnType<typeof redact>;
