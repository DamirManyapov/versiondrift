// Stands in for @versiondrift/detect in the Cloudflare build (vite.config.ts): the public site polls no hosts.
import type { generateSshKey as GenerateSshKey } from '@versiondrift/detect';

export const generateSshKey: typeof GenerateSshKey = () => {
  throw new Error('host detection is not available in this build (self-hosted only)');
};
