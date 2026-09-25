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
  },
};
