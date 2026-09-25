// The public feed as reactive state for the browser (the index is public data, so one instance is fine).
import type { FeedIndex } from '@versiondrift/schema';
import { feedBaseUrl } from '$lib/config';
import { FeedClient } from './client.ts';

class FeedState {
  client = new FeedClient(feedBaseUrl());
  index = $state<FeedIndex | undefined>();
  error = $state<string | undefined>();
  loading = $state(false);

  async load(force = false): Promise<void> {
    if (force) this.client.refresh();
    this.loading = true;
    try {
      this.index = await this.client.index();
      this.error = undefined;
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.loading = false;
    }
  }
}

export const feed = new FeedState();
