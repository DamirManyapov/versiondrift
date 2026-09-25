import { describe, expect, it } from 'vitest';
import { hashPassword, openStorage, StoreError, verifyPassword } from '../src/index.ts';

describe('passwords', () => {
  it('hash with a fresh salt and verify', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('AuthStore', () => {
  it('creates users and checks passwords', async () => {
    const { auth } = openStorage(':memory:');
    expect(auth.userCount()).toBe(0);
    const admin = await auth.createUser({ name: 'admin', password: 'change-me-please' });
    expect(admin).toMatchObject({ name: 'admin', role: 'admin' });
    expect(await auth.checkPassword('admin', 'change-me-please')).toEqual(admin);
    expect(await auth.checkPassword('admin', 'nope')).toBeUndefined();
    expect(await auth.checkPassword('nobody', 'change-me-please')).toBeUndefined();
    await expect(auth.createUser({ name: 'admin' })).rejects.toThrow(StoreError);
    await expect(auth.setPassword(admin.id, 'short')).rejects.toThrow(/8 characters/);
    await auth.setPassword(admin.id, 'a much better one');
    expect(await auth.checkPassword('admin', 'a much better one')).toEqual(admin);
  });

  it('users without a password can never sign in with one', async () => {
    const { auth } = openStorage(':memory:');
    auth.findOrCreateExternal({ key: 'header', subject: 'alice', name: 'alice' });
    expect(await auth.checkPassword('alice', '')).toBeUndefined();
  });

  it('keeps sessions by token hash until they expire or are deleted', async () => {
    const { auth } = openStorage(':memory:');
    const user = await auth.createUser({ name: 'admin', password: 'change-me-please' });
    const now = new Date('2026-09-26T00:00:00Z');
    const token = auth.createSession(user.id, 30, now);
    expect(auth.sessionUser(token, now)).toEqual(user);
    expect(auth.sessionUser(token + 'x', now)).toBeUndefined();
    expect(auth.sessionUser(token, new Date('2026-10-27T00:00:00Z'))).toBeUndefined();
    expect(auth.deleteExpiredSessions(new Date('2026-10-27T00:00:00Z'))).toBe(1);
    const again = auth.createSession(user.id, 30, now);
    auth.deleteSessionsOf(user.id);
    expect(auth.sessionUser(again, now)).toBeUndefined();
  });

  it('maps OIDC subjects and proxy users to one account each', () => {
    const { auth } = openStorage(':memory:');
    const a = auth.findOrCreateExternal({
      key: 'oidc',
      subject: 'sub-1',
      name: 'Alice',
      email: 'a@example.com',
    });
    expect(auth.findOrCreateExternal({ key: 'oidc', subject: 'sub-1', name: 'Alice B.' })).toEqual(a);
    const other = auth.findOrCreateExternal({ key: 'oidc', subject: 'sub-2', name: 'Alice' });
    expect(other.name).toBe('Alice (2)');
    const bob = auth.findOrCreateExternal({ key: 'header', subject: 'bob', name: 'bob' });
    expect(auth.findOrCreateExternal({ key: 'header', subject: 'bob', name: 'bob' })).toEqual(bob);
  });
});
