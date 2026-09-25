// The self-hosted board store (docs/07): boards, their product instances and instance-wide settings in SQLite.
import Database from 'better-sqlite3';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { AuthStore } from './auth.ts';
import { MIGRATIONS } from './migrations.ts';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema>;

/** A board entry as the web app's inventory model writes it (`InventoryItem`). */
export interface BoardItem {
  p: string;
  ver?: string;
  track?: string;
  label?: string;
}

export interface BoardSummary {
  id: number;
  name: string;
}

export class StoreError extends Error {
  override name = 'StoreError';
}

const DEFAULT_BOARD = 'Main';

/** Applies the embedded migrations that this database hasn't seen, each in its own transaction. */
export function migrate(sqlite: Database.Database): string[] {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS vd_migrations (tag TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
  );
  const done = new Set(
    sqlite
      .prepare('SELECT tag FROM vd_migrations')
      .all()
      .map((row) => (row as { tag: string }).tag),
  );
  const applied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.tag)) continue;
    sqlite.transaction(() => {
      for (const statement of migration.statements) sqlite.exec(statement);
      sqlite
        .prepare('INSERT INTO vd_migrations (tag, applied_at) VALUES (?, ?)')
        .run(migration.tag, new Date().toISOString());
    })();
    applied.push(migration.tag);
  }
  return applied;
}

export class BoardStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  boards(): BoardSummary[] {
    return this.db
      .select({ id: schema.boards.id, name: schema.boards.name })
      .from(schema.boards)
      .orderBy(asc(schema.boards.position), asc(schema.boards.id))
      .all();
  }

  /** The first board, created on first use so the app always has one. */
  defaultBoard(): BoardSummary {
    return this.boards()[0] ?? this.createBoard(DEFAULT_BOARD);
  }

  createBoard(name: string): BoardSummary {
    const clean = this.checkName(name);
    const position = this.db
      .select({ max: sql<number>`coalesce(max(${schema.boards.position}), -1)` })
      .from(schema.boards)
      .get()!.max;
    return this.db
      .insert(schema.boards)
      .values({ name: clean, position: position + 1 })
      .returning({ id: schema.boards.id, name: schema.boards.name })
      .get();
  }

  renameBoard(id: number, name: string): void {
    const clean = this.checkName(name, id);
    const result = this.db.update(schema.boards).set({ name: clean }).where(eq(schema.boards.id, id)).run();
    if (result.changes === 0) throw new StoreError(`no board ${id}`);
  }

  /** Deletes a board and its instances; the last board can't be deleted. */
  deleteBoard(id: number): void {
    if (this.boards().length <= 1) throw new StoreError('the last board cannot be deleted');
    const result = this.db.delete(schema.boards).where(eq(schema.boards.id, id)).run();
    if (result.changes === 0) throw new StoreError(`no board ${id}`);
  }

  /** The board's items in board order, or undefined for an unknown board. */
  items(boardId: number): BoardItem[] | undefined {
    if (!this.db.select().from(schema.boards).where(eq(schema.boards.id, boardId)).get()) return undefined;
    return this.db
      .select()
      .from(schema.instances)
      .where(eq(schema.instances.boardId, boardId))
      .orderBy(asc(schema.instances.position), asc(schema.instances.id))
      .all()
      .map((row) => ({
        p: row.productId,
        ...(row.version && { ver: row.version }),
        ...(row.track && { track: row.track }),
        ...((row.label ?? row.host) && { label: (row.label ?? row.host)! }),
      }));
  }

  /** Replaces the board's items (the web app saves the whole board, like the browser store). */
  replaceItems(boardId: number, items: BoardItem[]): void {
    this.db.transaction((tx) => {
      if (!tx.select().from(schema.boards).where(eq(schema.boards.id, boardId)).get())
        throw new StoreError(`no board ${boardId}`);
      tx.delete(schema.instances).where(eq(schema.instances.boardId, boardId)).run();
      if (items.length === 0) return;
      tx.insert(schema.instances)
        .values(
          items.map((item, position) => ({
            boardId,
            productId: item.p,
            version: item.ver ?? null,
            track: item.track ?? null,
            label: item.label ?? null,
            position,
          })),
        )
        .run();
    });
  }

  settings(): Record<string, unknown> {
    return Object.fromEntries(
      this.db
        .select()
        .from(schema.settings)
        .all()
        .map((row) => [row.key, row.value]),
    );
  }

  setSettings(patch: Record<string, unknown>): void {
    this.db.transaction((tx) => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        tx.insert(schema.settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
          .run();
      }
    });
  }

  private checkName(name: string, except?: number): string {
    const clean = name.trim();
    if (clean === '' || clean.length > 60) throw new StoreError('a board name has 1–60 characters');
    const same = this.boards().find((b) => b.name.toLowerCase() === clean.toLowerCase() && b.id !== except);
    if (same) throw new StoreError(`a board named "${clean}" already exists`);
    return clean;
  }
}

export interface Storage {
  store: BoardStore;
  auth: AuthStore;
  db: Db;
  close(): void;
}

/** Opens (or creates) the database file, applies migrations and returns the store. ":memory:" works for tests. */
export function openStorage(file: string): Storage {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  migrate(sqlite);
  const db = drizzle(sqlite, { schema });
  return { store: new BoardStore(db), auth: new AuthStore(db), db, close: () => sqlite.close() };
}
