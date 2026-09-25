// Product files for the products on the board, loaded lazily through the FeedClient.
import type { FeedProduct } from '@versiondrift/schema';
import { feed } from '../feed/state.svelte.ts';

class ProductCache {
  products = $state<Record<string, FeedProduct>>({});
  errors = $state<Record<string, string>>({});
  private pending = new Set<string>();

  /** Loads what is missing, six at a time. `force` reloads everything (after "Refresh"). */
  async ensure(ids: string[], force = false): Promise<void> {
    const index = feed.index;
    if (!index) return;
    const wanted = [...new Set(ids)].filter(
      (id) => id in index.products && (force || !(id in this.products)) && !this.pending.has(id),
    );
    for (let i = 0; i < wanted.length; i += 6) {
      await Promise.all(
        wanted.slice(i, i + 6).map(async (id) => {
          this.pending.add(id);
          try {
            this.products[id] = await feed.client.product(id);
            delete this.errors[id];
          } catch (error) {
            this.errors[id] = (error as Error).message;
          } finally {
            this.pending.delete(id);
          }
        }),
      );
    }
  }
}

export const productCache = new ProductCache();
