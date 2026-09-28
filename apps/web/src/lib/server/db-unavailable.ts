// Stands in for @versiondrift/db in the Cloudflare build (vite.config.ts): the public site has no SQLite.
import type {
  AlertEventName,
  openStorage as OpenStorage,
  seedFleetDemo as SeedFleetDemo,
} from '@versiondrift/db';

export const ALERT_EVENTS: AlertEventName[] = ['critical', 'eol', 'update', 'digest'];

export class StoreError extends Error {
  override name = 'StoreError';
}

export const seedFleetDemo: typeof SeedFleetDemo = () => false;

export const openStorage: typeof OpenStorage = () => {
  throw new Error(
    'self-hosted storage is not available in this build (VD_MODE=selfhosted needs the Node image)',
  );
};
