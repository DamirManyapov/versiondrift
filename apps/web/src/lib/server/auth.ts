// Sign-in for self-hosted instances (docs/07 "Auth"): VD_AUTH = none | password | oidc | header.
// The public site has no accounts yet (S7); nothing here runs there.
import { randomBytes } from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import type { User } from '@versiondrift/db';
import { env } from '$env/dynamic/private';
import { selfHostedStorage } from './storage.ts';

export type AuthMode = 'none' | 'password' | 'oidc' | 'header';

export const SESSION_COOKIE = 'vd_session';
const SESSION_DAYS = 30;

export function authMode(): AuthMode {
  const value = (env.VD_AUTH ?? 'password').trim().toLowerCase();
  if (value === 'none' || value === 'oidc' || value === 'header') return value;
  return 'password';
}

/** The proxy header that names the signed-in user in `header` mode (Authelia, Authentik, oauth2-proxy…). */
export const trustedHeader = () => (env.VD_TRUST_PROXY_HEADER || 'Remote-User').toLowerCase();

/** Everyone is this user when VD_AUTH=none (a trusted LAN, or auth done elsewhere without a header). */
const ANONYMOUS: User = { id: 0, name: 'admin', email: null, role: 'admin' };

let bootstrapped = false;

/**
 * Password mode, first start: create "admin" with VD_ADMIN_PASSWORD, or with a random password printed once to
 * the log (the operator reads it with `docker logs`).
 */
export async function bootstrapAdmin(log: (line: string) => void = console.log): Promise<void> {
  if (bootstrapped || authMode() !== 'password') return;
  bootstrapped = true;
  const { auth } = selfHostedStorage();
  if (auth.userCount() > 0) return;
  const given = env.VD_ADMIN_PASSWORD;
  const password = given && given.length >= 8 ? given : randomBytes(12).toString('base64url');
  await auth.createUser({ name: 'admin', role: 'admin', password });
  log(
    given && given.length >= 8
      ? 'VersionDrift: created user "admin" with the password from VD_ADMIN_PASSWORD'
      : `VersionDrift: created user "admin" with password ${password} — change it under Account after signing in`,
  );
}

/** The signed-in user for this request, if any. */
export function currentUser(event: RequestEvent): User | undefined {
  const mode = authMode();
  if (mode === 'none') return ANONYMOUS;
  const { auth } = selfHostedStorage();
  if (mode === 'header') {
    const name = event.request.headers.get(trustedHeader())?.trim();
    return name ? auth.findOrCreateExternal({ key: 'header', subject: name, name }) : undefined;
  }
  const token = event.cookies.get(SESSION_COOKIE);
  return token ? auth.sessionUser(token) : undefined;
}

/**
 * Whether the browser talks https to us. adapter-node reports https for every request unless ORIGIN is set, so
 * only a configured URL or the proxy's X-Forwarded-Proto count; a Secure cookie on plain http would be dropped.
 */
export function isHttps(request: Request): boolean {
  const base = env.ORIGIN || env.VD_BASE_URL;
  if (base) return base.startsWith('https:');
  return request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}

export function startSession(cookies: Cookies, request: Request, user: User): void {
  const token = selfHostedStorage().auth.createSession(user.id, SESSION_DAYS);
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    maxAge: SESSION_DAYS * 86_400,
  });
}

/**
 * CSRF: a state-changing request from a browser must come from this site — its Origin host equals the request's
 * host (or ORIGIN's), and the browser doesn't call it cross-site. Clients without these headers carry no victim's
 * cookies and pass.
 */
export function crossSite(request: Request, url: URL): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host !== url.host;
  } catch {
    return true;
  }
}

export function endSession(cookies: Cookies): void {
  const token = cookies.get(SESSION_COOKIE);
  if (token) selfHostedStorage().auth.deleteSession(token);
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Paths reachable without signing in (the feed mirror is public data). Static files never reach the hooks. */
export const isOpenPath = (pathname: string) =>
  pathname === '/login' ||
  pathname === '/healthz' ||
  pathname.startsWith('/auth/') ||
  pathname.startsWith('/feed/');

/** Only same-site relative paths, so ?next= can't send people elsewhere after signing in. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

/** At most 10 failed sign-ins per client address and name in 15 minutes. */
const failures = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
const LIMIT = 10;

export function tooManyAttempts(key: string, now = Date.now()): boolean {
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW);
  failures.set(key, recent);
  return recent.length >= LIMIT;
}

export function recordFailure(key: string, now = Date.now()): void {
  failures.set(key, [...(failures.get(key) ?? []), now]);
  if (failures.size > 10_000) failures.clear(); // bounded memory under a spray of addresses
}

/** A text field of a submitted form ("" when missing or a file). */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
