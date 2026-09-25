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
