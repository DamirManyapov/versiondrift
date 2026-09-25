import { runAlerts } from '$lib/server/alerts';
import { noContent } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

/** "Check now" in Settings: one notification pass without waiting for the next feed sync. */
export const POST: RequestHandler = async () => {
  selfHostedStorage();
  await runAlerts();
  return noContent();
};
