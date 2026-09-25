// Stands in for @versiondrift/db in the Cloudflare build (vite.config.ts): the public site has no SQLite.
import type { openStorage as OpenStorage } from '@versiondrift/db';

export class StoreError extends Error {
  override name = 'StoreError';
}

export const openStorage: typeof OpenStorage = () => {
  throw new Error(
    'self-hosted storage is not available in this build (VD_MODE=selfhosted needs the Node image)',
  );
};
