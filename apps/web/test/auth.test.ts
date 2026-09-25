import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { VD_MODE: 'selfhosted', VD_DATA_DIR: ':memory:' } }));
const { authMode, crossSite, isHttps, isOpenPath, recordFailure, safeNext, tooManyAttempts } =
  await import('../src/lib/server/auth.ts');

describe('sign-in helpers', () => {
  it('defaults to password sign-in', () => {
    expect(authMode()).toBe('password');
  });

  it('only follows same-site paths after signing in', () => {
    expect(safeNext('/p/grafana?x=1')).toBe('/p/grafana?x=1');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });

  it('leaves only sign-in and health checks open', () => {
    expect(isOpenPath('/login')).toBe(true);
    expect(isOpenPath('/auth/oidc/callback')).toBe(true);
    expect(isOpenPath('/healthz')).toBe(true);
    expect(isOpenPath('/feed/v1/index.json')).toBe(true);
    expect(isOpenPath('/api/boards')).toBe(false);
    expect(isOpenPath('/loginx')).toBe(false);
  });

  it('limits failed attempts per key within 15 minutes', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(tooManyAttempts('1.2.3.4|admin', t0)).toBe(false);
      recordFailure('1.2.3.4|admin', t0);
    }
    expect(tooManyAttempts('1.2.3.4|admin', t0 + 1000)).toBe(true);
    expect(tooManyAttempts('5.6.7.8|admin', t0 + 1000)).toBe(false);
    expect(tooManyAttempts('1.2.3.4|admin', t0 + 16 * 60_000)).toBe(false);
  });

  it('refuses cross-site state changes, by Origin host or Sec-Fetch-Site', () => {
    const url = new URL('https://vd.lan:8080/login'); // adapter-node's guess; the host is what counts
    const post = (headers: Record<string, string>) =>
      new Request('http://vd.lan:8080/login', { method: 'POST', headers });
    expect(crossSite(post({ origin: 'http://vd.lan:8080' }), url)).toBe(false);
    expect(crossSite(post({ origin: 'https://evil.example' }), url)).toBe(true);
    expect(crossSite(post({ 'sec-fetch-site': 'cross-site' }), url)).toBe(true);
    expect(crossSite(post({}), url)).toBe(false);
    expect(
      crossSite(new Request('http://vd.lan:8080/', { headers: { origin: 'https://evil.example' } }), url),
    ).toBe(false);
  });

  it('marks cookies Secure only when https is known', () => {
    expect(isHttps(new Request('http://vd.lan/'))).toBe(false);
    expect(isHttps(new Request('http://vd.lan/', { headers: { 'x-forwarded-proto': 'https' } }))).toBe(true);
  });
});
