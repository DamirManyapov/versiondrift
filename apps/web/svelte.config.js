// One app, two targets (ADR-0002): VD_ADAPTER=cloudflare (versiondrift.dev) or node (self-hosted Docker image).
import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterNode from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const target = process.env.VD_ADAPTER ?? 'cloudflare';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: target === 'node' ? adapterNode({ out: 'build' }) : adapterCloudflare(),
    // SvelteKit compares the Origin header with the app's URL, which adapter-node assumes is https unless ORIGIN is
    // set — so every form post on a plain-http self-hosted instance would fail. hooks.server.ts checks Origin
    // against the request's host instead (docs/07 "Auth").
    csrf: { trustedOrigins: ['*'] },
  },
};
