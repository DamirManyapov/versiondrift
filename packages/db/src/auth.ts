// Users and sessions for self-hosted sign-in (docs/07 "Auth"). Passwords: scrypt from node:crypto (argon2id would
// need a native module or Node ≥ 24). Sessions: a random token in the cookie, only its sha256 in the database.
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import * as schema from './schema.ts';
import { StoreError, type Db } from './store.ts';

export type Role = 'admin' | 'viewer';

export interface User {
  id: number;
  name: string;
  email: string | null;
  role: Role;
}

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 };

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number; keylen: number }) {
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r };
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, params.keylen, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** "scrypt$N$r$p$salt$hash" (base64url), so the parameters can grow without breaking stored hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
  });
  return timingSafeEqual(key, expected);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const PUBLIC_FIELDS = {
  id: schema.users.id,
  name: schema.users.name,
  email: schema.users.email,
  role: schema.users.role,
};

export class AuthStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  userCount(): number {
    return this.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.users)
      .get()!.n;
  }

  userById(id: number): User | undefined {
    return this.db.select(PUBLIC_FIELDS).from(schema.users).where(eq(schema.users.id, id)).get();
  }

  userByName(name: string): User | undefined {
    return this.db.select(PUBLIC_FIELDS).from(schema.users).where(eq(schema.users.name, name.trim())).get();
  }

  async createUser(input: { name: string; role?: Role; email?: string; password?: string }): Promise<User> {
    const name = input.name.trim();
    if (name === '' || name.length > 100) throw new StoreError('a user name has 1–100 characters');
    if (this.userByName(name)) throw new StoreError(`user "${name}" already exists`);
    return this.db
      .insert(schema.users)
      .values({
        name,
        role: input.role ?? 'admin',
        email: input.email ?? null,
        passwordHash: input.password === undefined ? null : await hashPassword(input.password),
      })
      .returning(PUBLIC_FIELDS)
      .get();
  }

  async setPassword(userId: number, password: string): Promise<void> {
    if (password.length < 8) throw new StoreError('a password has at least 8 characters');
    this.db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(schema.users.id, userId))
      .run();
  }

  /** The user when name and password match; undefined otherwise (same work either way). */
  async checkPassword(name: string, password: string): Promise<User | undefined> {
    const row = this.db.select().from(schema.users).where(eq(schema.users.name, name.trim())).get();
    // Hash anyway for unknown users, so response times don't reveal which names exist.
    const stored = row?.passwordHash ?? (await dummyHash());
    const ok = await verifyPassword(password, stored);
    return ok && row?.passwordHash ? this.userById(row.id) : undefined;
  }

  /** The user signed in through OIDC or a trusted proxy header, created on first sight. */
  findOrCreateExternal(input: {
    key: 'oidc' | 'header';
    subject: string;
    name: string;
    email?: string;
  }): User {
    if (input.key === 'oidc') {
      const found = this.db
        .select(PUBLIC_FIELDS)
        .from(schema.users)
        .where(eq(schema.users.oidcSub, input.subject))
        .get();
      if (found) return found;
    } else {
      const found = this.userByName(input.subject);
      if (found) return found;
    }
    let name = (input.key === 'oidc' ? input.name : input.subject).trim().slice(0, 100) || input.subject;
    // A display name may collide with an existing user: make it unique.
    for (let i = 2; this.userByName(name); i++) name = `${input.name.trim().slice(0, 90)} (${i})`;
    return this.db
      .insert(schema.users)
      .values({
        name,
        email: input.email ?? null,
        role: 'admin',
        oidcSub: input.key === 'oidc' ? input.subject : null,
      })
      .returning(PUBLIC_FIELDS)
      .get();
  }

  /** A new session token for the cookie (valid `days` days). */
  createSession(userId: number, days = 30, now: Date = new Date()): string {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(now.getTime() + days * 86_400_000);
    this.db
      .insert(schema.sessions)
      .values({ tokenHash: tokenHash(token), userId, expiresAt: iso(expires) })
      .run();
    return token;
  }

  sessionUser(token: string, now: Date = new Date()): User | undefined {
    const row = this.db
      .select({ userId: schema.sessions.userId })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.tokenHash, tokenHash(token)), gt(schema.sessions.expiresAt, iso(now))))
      .get();
    return row ? this.userById(row.userId) : undefined;
  }

  deleteSession(token: string): void {
    this.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.tokenHash, tokenHash(token)))
      .run();
  }

  /** Signs a user out everywhere (after a password change). */
  deleteSessionsOf(userId: number): void {
    this.db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)).run();
  }

  deleteExpiredSessions(now: Date = new Date()): number {
    return this.db
      .delete(schema.sessions)
      .where(lte(schema.sessions.expiresAt, iso(now)))
      .run().changes;
  }
}

// A valid hash of a random password, for timing-equal checks of unknown users.
let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));
