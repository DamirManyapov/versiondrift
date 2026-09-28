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

/** Kinds of host a detector can read (ADR-0007); an access profile serves hosts of its kind. */
export const HOST_KINDS = ['ssh-linux', 'windows', 'routeros', 'proxmox'] as const;

/** Poll states of a host (docs/07); `none` = no access profile, versions typed by hand. */
export const POLL_STATES = ['pending', 'ok', 'unreachable', 'auth-failed', 'unknown', 'none'] as const;

/**
 * Read-only credentials shared by many hosts (ADR-0007). `secret` (password or API token) and `private_key` are
 * sealed with the instance key and never leave the server; `public_key` is what an admin installs on Linux hosts.
 */
export const accessProfiles = sqliteTable('access_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  kind: text('kind', { enum: HOST_KINDS }).notNull(),
  username: text('username').notNull(),
  secret: text('secret'),
  privateKey: text('private_key'),
  publicKey: text('public_key'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/**
 * Hosts the instance polls, grouped by site (a site is a board, docs/specs/fleet-ui-tasks.md "Plan"). The poll
 * state stays on the row; its changes and version changes go to `host_events`.
 */
export const hosts = sqliteTable(
  'hosts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    boardId: integer('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull().unique(),
    address: text('address').notNull(),
    port: integer('port'),
    kind: text('kind', { enum: HOST_KINDS }).notNull(),
    accessProfileId: integer('access_profile_id').references(() => accessProfiles.id, {
      onDelete: 'set null',
    }),
    pollState: text('poll_state', { enum: POLL_STATES }).notNull().default('pending'),
    /** When the current poll state began (a problem's "since"). */
    pollSince: text('poll_since'),
    lastAttemptAt: text('last_attempt_at'),
    lastSuccessAt: text('last_success_at'),
    pollErrorCode: text('poll_error_code'),
    pollErrorMessage: text('poll_error_message'),
    /** Trusted on first use: the SSH host key (SHA256:…) and the TLS certificate (SHA-256) of the first contact. */
    hostKey: text('host_key'),
    tlsFingerprint: text('tls_fingerprint'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('hosts_board').on(t.boardId)],
);

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
    /** The host this instance runs on; detected instances always have one. */
    hostId: integer('host_id').references(() => hosts.id, { onDelete: 'cascade' }),
    /** What the detector read, kept when the version could not be recognized. */
    readRaw: text('read_raw'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('instances_board').on(t.boardId, t.position), index('instances_host').on(t.hostId)],
);

/** A host's history: version changes found by polls and poll state changes ("stopped answering"). */
export const hostEvents = sqliteTable(
  'host_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    hostId: integer('host_id')
      .notNull()
      .references(() => hosts.id, { onDelete: 'cascade' }),
    at: text('at').notNull().default(now),
    kind: text('kind', { enum: ['version', 'poll'] }).notNull(),
    productId: text('product_id'),
    fromVersion: text('from_version'),
    toVersion: text('to_version'),
    pollState: text('poll_state', { enum: POLL_STATES }),
    message: text('message'),
  },
  (t) => [index('host_events_host').on(t.hostId, t.at)],
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
