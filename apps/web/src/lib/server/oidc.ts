// OpenID Connect sign-in for self-hosted instances (VD_AUTH=oidc; Authentik, Keycloak, Google, …): authorization code
// flow with PKCE, state and nonce kept in a short-lived cookie. oauth4webapi does the protocol checks.
import type { Cookies } from '@sveltejs/kit';
import * as oauth from 'oauth4webapi';
import { env } from '$env/dynamic/private';

const FLOW_COOKIE = 'vd_oidc';
const SCOPE = 'openid profile email';

export interface OidcIdentity {
  subject: string;
  name: string;
  email?: string;
}

interface Provider {
  as: oauth.AuthorizationServer;
  client: oauth.Client;
  auth: oauth.ClientAuth;
}

let provider: Promise<Provider> | undefined;

/** Options for oauth4webapi requests; tests swap the fetch. */
export const requestOptions: { [oauth.customFetch]?: typeof fetch } = {};

function settings() {
  const issuer = env.VD_OIDC_ISSUER;
  const clientId = env.VD_OIDC_CLIENT_ID;
  if (!issuer || !clientId) throw new Error('VD_AUTH=oidc needs VD_OIDC_ISSUER and VD_OIDC_CLIENT_ID');
  return { issuer: new URL(issuer), clientId, secret: env.VD_OIDC_CLIENT_SECRET };
}

async function discover(): Promise<Provider> {
  const { issuer, clientId, secret } = settings();
  const as = await oauth.processDiscoveryResponse(
    issuer,
    await oauth.discoveryRequest(issuer, requestOptions),
  );
  return {
    as,
    client: { client_id: clientId },
    // A public client (PKCE only) when no secret is configured.
    auth: secret ? oauth.ClientSecretPost(secret) : oauth.None(),
  };
}

function getProvider(): Promise<Provider> {
  provider ??= discover().catch((error: unknown) => {
    provider = undefined; // try discovery again on the next sign-in
    throw error;
  });
  return provider;
}

/** Forget the discovered provider (tests, configuration changes). */
export function resetOidc(): void {
  provider = undefined;
}

/** The callback URL registered at the identity provider: VD_BASE_URL, else this request's origin. */
export const redirectUri = (origin: string) =>
  new URL('/auth/oidc/callback', env.VD_BASE_URL || env.ORIGIN || origin).toString();

/** Where to send the browser to sign in; remembers the flow's secrets in a cookie. */
export async function authorizationUrl(
  cookies: Cookies,
  origin: string,
  next: string,
  secure = redirectUri(origin).startsWith('https:'),
): Promise<URL> {
  const { as, client } = await getProvider();
  if (!as.authorization_endpoint) throw new Error('the identity provider has no authorization endpoint');
  const verifier = oauth.generateRandomCodeVerifier();
  const state = oauth.generateRandomState();
  const nonce = oauth.generateRandomNonce();
  cookies.set(FLOW_COOKIE, JSON.stringify({ verifier, state, nonce, next }), {
    path: '/auth/oidc',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 600,
  });
  const url = new URL(as.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: SCOPE,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  }).toString();
  return url;
}

/** Completes the flow at the callback: the signed-in identity and where to go next. */
export async function completeSignIn(
  cookies: Cookies,
  url: URL,
): Promise<{ identity: OidcIdentity; next: string }> {
  const raw = cookies.get(FLOW_COOKIE);
  cookies.delete(FLOW_COOKIE, { path: '/auth/oidc' });
  if (!raw) throw new Error('the sign-in took too long or started elsewhere; try again');
  const flow = JSON.parse(raw) as { verifier: string; state: string; nonce: string; next: string };
  const { as, client, auth } = await getProvider();
  const params = oauth.validateAuthResponse(as, client, url, flow.state);
  const response = await oauth.authorizationCodeGrantRequest(
    as,
    client,
    auth,
    params,
    redirectUri(url.origin),
    flow.verifier,
    requestOptions,
  );
  const result = await oauth.processAuthorizationCodeResponse(as, client, response, {
    expectedNonce: flow.nonce,
    requireIdToken: true,
  });
  const claims = oauth.getValidatedIdTokenClaims(result)!;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const email = text(claims.email);
  return {
    identity: {
      subject: `${claims.iss}|${claims.sub}`,
      name: text(claims.name) ?? text(claims.preferred_username) ?? email ?? claims.sub,
      ...(email && { email }),
    },
    next: flow.next,
  };
}
