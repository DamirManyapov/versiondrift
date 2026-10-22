// Notification channels with their secrets sealed at rest (docs/07 "Security": credentials encrypted with
// VD_SECRET_KEY). AES-256-GCM from node:crypto; the key comes from VD_SECRET_KEY or a generated key file.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import * as schema from './schema.ts';
import { StoreError, type Db } from './store.ts';

export interface Sealer {
  seal(plain: string): string;
  open(sealed: string): string;
}

/** A sealer from any secret string (VD_SECRET_KEY) or 32 random bytes (the generated key file). */
export function createSealer(secret: string | Buffer): Sealer {
  const key = typeof secret === 'string' ? createHash('sha256').update(secret).digest() : secret;
  if (key.length !== 32) throw new Error('a sealing key has 32 bytes');
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return [
        'v1',
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        data.toString('base64'),
      ].join(':');
    },
    open(sealed) {
      const [version, iv, tag, data] = sealed.split(':');
      if (version !== 'v1' || !iv || !tag || data === undefined)
        throw new StoreError('unknown sealed format');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      try {
        return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
          'utf8',
        );
      } catch {
        throw new StoreError('cannot decrypt channel settings: VD_SECRET_KEY changed?');
      }
    },
  };
}

export type AlertEventName = 'critical' | 'eol' | 'update' | 'digest';
export const ALERT_EVENTS: AlertEventName[] = ['critical', 'eol', 'update', 'digest'];

export interface ChannelRecord {
  id: number;
  name: string;
  kind: 'telegram' | 'mattermost' | 'ntfy' | 'gotify' | 'webhook' | 'email';
  /** Decrypted settings (tokens included): server-side only. */
  config: Record<string, unknown>;
  events: AlertEventName[];
  lang: 'en' | 'ru';
  digestDay: number | null;
  enabled: boolean;
  state: unknown;
  lastSentAt: string | null;
  lastError: string | null;
}

export type ChannelInput = Pick<
  ChannelRecord,
  'name' | 'kind' | 'config' | 'events' | 'lang' | 'digestDay'
> & {
  enabled?: boolean;
};

export class ChannelStore {
  private readonly db: Db;
  private readonly sealer: Sealer;

  constructor(db: Db, sealer: Sealer) {
    this.db = db;
    this.sealer = sealer;
  }

  private decode(row: typeof schema.channels.$inferSelect): ChannelRecord {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      config: JSON.parse(this.sealer.open(row.config)) as Record<string, unknown>,
      events: row.events.filter((e): e is AlertEventName => ALERT_EVENTS.includes(e as AlertEventName)),
      lang: row.lang,
      digestDay: row.digestDay,
      enabled: row.enabled,
      state: row.state,
      lastSentAt: row.lastSentAt,
      lastError: row.lastError,
    };
  }

  list(): ChannelRecord[] {
    return this.db
      .select()
      .from(schema.channels)
      .orderBy(asc(schema.channels.id))
      .all()
      .map((row) => this.decode(row));
  }

  get(id: number): ChannelRecord | undefined {
    const row = this.db.select().from(schema.channels).where(eq(schema.channels.id, id)).get();
    return row && this.decode(row);
  }

  create(input: ChannelInput): ChannelRecord {
    const name = input.name.trim();
    if (!name || name.length > 60) throw new StoreError('a channel name has 1–60 characters');
    const row = this.db
      .insert(schema.channels)
      .values({
        name,
        kind: input.kind,
        config: this.sealer.seal(JSON.stringify(input.config)),
        events: input.events,
        lang: input.lang,
        digestDay: input.digestDay,
        enabled: input.enabled ?? true,
      })
      .returning()
      .get();
    return this.decode(row);
  }

  /** Changing settings or subscriptions keeps the channel's state (what it already reported). */
  update(id: number, patch: Partial<ChannelInput>): ChannelRecord {
    const current = this.get(id);
    if (!current) throw new StoreError(`no channel ${id}`);
    const name = patch.name?.trim();
    if (name !== undefined && (!name || name.length > 60))
      throw new StoreError('a channel name has 1–60 characters');
    this.db
      .update(schema.channels)
      .set({
        ...(name !== undefined && { name }),
        ...(patch.config && { config: this.sealer.seal(JSON.stringify(patch.config)) }),
        ...(patch.events && { events: patch.events }),
        ...(patch.lang && { lang: patch.lang }),
        ...(patch.digestDay !== undefined && { digestDay: patch.digestDay }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      })
      .where(eq(schema.channels.id, id))
      .run();
    return this.get(id)!;
  }

  remove(id: number): void {
    if (this.db.delete(schema.channels).where(eq(schema.channels.id, id)).run().changes === 0)
      throw new StoreError(`no channel ${id}`);
  }

  /**
   * After a run: the new state when everything was delivered (lastSentAt moves only if something was sent), or the
   * error (state kept, so the next run reports the same changes again).
   */
  recordRun(id: number, result: { state: unknown; at: string; sent: number } | { error: string }): void {
    this.db
      .update(schema.channels)
      .set(
        'error' in result
          ? { lastError: result.error.slice(0, 500) }
          : { state: result.state, lastError: null, ...(result.sent > 0 && { lastSentAt: result.at }) },
      )
      .where(eq(schema.channels.id, id))
      .run();
  }
}
