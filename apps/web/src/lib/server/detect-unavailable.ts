// Stands in for @versiondrift/detect in the Cloudflare build (vite.config.ts): the public site polls no hosts.
import type { detect as Detect, generateSshKey as GenerateSshKey } from '@versiondrift/detect';

export const generateSshKey: typeof GenerateSshKey = () => {
  throw new Error('host detection is not available in this build (self-hosted only)');
};

export const detect: typeof Detect = () =>
  Promise.resolve({
    ok: false,
    state: 'unknown',
    code: 'unavailable',
    message: 'no detectors in this build',
  });
