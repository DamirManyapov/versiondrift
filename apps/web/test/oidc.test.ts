import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: {
    VD_OIDC_ISSUER: 'https://idp.test/',
    VD_OIDC_CLIENT_ID: 'versiondrift',
    VD_OIDC_CLIENT_SECRET: 's3cret',
  },
}));

const oauth = await import('oauth4webapi');
const { authorizationUrl, completeSignIn, requestOptions, resetOidc } =
  await import('../src/lib/server/oidc.ts');

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function cookieJar(): Cookies & { jar: Map<string, string> } {
  const jar = new Map<string, string>();
  return {
    jar,
    get: (name: string) => jar.get(name),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
    serialize: () => '',
  };
}

/** A fake identity provider: discovery, and a token endpoint that records its requests. */
function idp(nonceOf: () => string, claims: Record<string, unknown> = {}) {
  const tokenRequests: URLSearchParams[] = [];
  const respond = (input: RequestInfo | URL, init?: RequestInit): Response => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://idp.test/.well-known/openid-configuration')
      return Response.json({
        issuer: 'https://idp.test/',
        authorization_endpoint: 'https://idp.test/authorize',
        token_endpoint: 'https://idp.test/token',
        jwks_uri: 'https://idp.test/jwks',
      });
    if (url === 'https://idp.test/token') {
      const body = new URLSearchParams(init?.body as string);
      tokenRequests.push(body);
      const now = Math.floor(Date.now() / 1000);
      const idToken = [
        b64({ alg: 'RS256', typ: 'JWT' }),
        b64({
          iss: 'https://idp.test/',
          aud: 'versiondrift',
          sub: 'user-42',
          iat: now,
          exp: now + 300,
          nonce: nonceOf(),
          name: 'Alice Example',
          email: 'alice@example.com',
          ...claims,
        }),
        'signature',
      ].join('.');
      return Response.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken });
    }
    return new Response('not found', { status: 404 });
  };
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(respond(input, init)),
  );
  return { fetch, tokenRequests };
}

describe('OIDC sign-in', () => {
  beforeEach(() => resetOidc());

  it('redirects with PKCE, state and nonce, then returns the identity from the ID token', async () => {
    const cookies = cookieJar();
    let nonce = '';
    const provider = idp(() => nonce);
    requestOptions[oauth.customFetch] = provider.fetch;

    const url = await authorizationUrl(cookies, 'https://vd.example.com', '/week');
    expect(url.origin + url.pathname).toBe('https://idp.test/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('https://vd.example.com/auth/oidc/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const flow = JSON.parse(cookies.jar.get('vd_oidc')!) as {
      state: string;
      nonce: string;
      verifier: string;
    };
    nonce = flow.nonce;

    const callback = new URL(`https://vd.example.com/auth/oidc/callback?code=abc&state=${flow.state}`);
    const { identity, next } = await completeSignIn(cookies, callback);
    expect(identity).toEqual({
      subject: 'https://idp.test/|user-42',
      name: 'Alice Example',
      email: 'alice@example.com',
    });
    expect(next).toBe('/week');
    expect(provider.tokenRequests[0]?.get('code_verifier')).toBe(flow.verifier);
    expect(provider.tokenRequests[0]?.get('client_secret')).toBe('s3cret');
    expect(cookies.jar.has('vd_oidc')).toBe(false);
  });

  it('rejects a callback with the wrong state or nonce, or without a flow cookie', async () => {
    const provider = idp(() => 'not-the-nonce');
    requestOptions[oauth.customFetch] = provider.fetch;

    const cookies = cookieJar();
    await authorizationUrl(cookies, 'https://vd.example.com', '/');
    const flow = JSON.parse(cookies.jar.get('vd_oidc')!) as { state: string };
    await expect(
      completeSignIn(
        cookieJar(),
        new URL(`https://vd.example.com/auth/oidc/callback?code=abc&state=${flow.state}`),
      ),
    ).rejects.toThrow(/try again/);

    const wrongState = cookieJar();
    await authorizationUrl(wrongState, 'https://vd.example.com', '/');
    await expect(
      completeSignIn(wrongState, new URL('https://vd.example.com/auth/oidc/callback?code=abc&state=forged')),
    ).rejects.toThrow();

    const wrongNonce = cookieJar();
    await authorizationUrl(wrongNonce, 'https://vd.example.com', '/');
    const { state } = JSON.parse(wrongNonce.jar.get('vd_oidc')!) as { state: string };
    await expect(
      completeSignIn(
        wrongNonce,
        new URL(`https://vd.example.com/auth/oidc/callback?code=abc&state=${state}`),
      ),
    ).rejects.toThrow();
  });
});
