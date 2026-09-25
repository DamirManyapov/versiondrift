// Self-hosted database (docs/07 "SQLite schema"). Change it here, then `pnpm -F @versiondrift/db generate`
// writes a new migration to drizzle/ and embeds it in src/migrations.ts.
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;

/** Several boards per instance ("Prod", "Homelab"). */
export const boards = sqliteTable('boards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').notNull().default(now),
});

/**
 * One row per product instance on a board, in board order. A product followed without a version is an instance
 * with `version` null (the tile shows news only).
 */
export const instances = sqliteTable(
  'instances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    boardId: integer('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    version: text('version'),
    track: text('track'),
    label: text('label'),
    host: text('host'),
    source: text('source', { enum: ['manual', 'detector', 'import', 'integration'] })
      .notNull()
      .default('manual'),
    position: integer('position').notNull(),
    detectedAt: text('detected_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('instances_board').on(t.boardId, t.position)],
);

/** Instance-wide settings as JSON values (critical CVSS threshold, "hide up to date", …). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

/** People who can sign in (docs/07 "Auth"). Password users have a scrypt hash; OIDC users an issuer subject. */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  email: text('email'),
  role: text('role', { enum: ['admin', 'viewer'] })
    .notNull()
    .default('admin'),
  passwordHash: text('password_hash'),
  oidcSub: text('oidc_sub').unique(),
  createdAt: text('created_at').notNull().default(now),
});

/** Sign-in sessions; the cookie holds a random token, the table only its sha256. */
export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(now),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

/**
 * Notification channels (docs/07 "Notifications"). `config` is the channel's settings as sealed JSON (tokens and
 * passwords are secrets); `state` is what was last sent through it, so each channel reports changes on its own.
 */
export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['telegram', 'ntfy', 'gotify', 'webhook', 'email'] }).notNull(),
  config: text('config').notNull(),
  /** Subscribed events: critical, eol, update, digest. */
  events: text('events', { mode: 'json' }).$type<string[]>().notNull(),
  lang: text('lang', { enum: ['en', 'ru'] })
    .notNull()
    .default('en'),
  /** Weekday of the weekly digest, 0 = Sunday; null = none. */
  digestDay: integer('digest_day'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  state: text('state', { mode: 'json' }),
  lastSentAt: text('last_sent_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull().default(now),
});
