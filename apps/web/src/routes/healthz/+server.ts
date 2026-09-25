import type { RequestHandler } from './$types';

/** Liveness for Docker HEALTHCHECK and load balancers: the server is up and routing. */
export const GET: RequestHandler = () =>
  new Response('ok\n', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
