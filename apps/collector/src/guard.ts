// docs/04 step 10: refuse to publish a feed that looks broken compared with the previous one.
import type { FeedIndex } from '@versiondrift/schema';

export interface GuardInput {
  previous: FeedIndex | undefined;
  next: FeedIndex;
  /** Release counts per product before and after, for products present in both. */
  releaseCounts: Record<string, { before: number; after: number }>;
}

export function guardProblems({ previous, next, releaseCounts }: GuardInput): string[] {
  if (!previous) return [];
  const problems: string[] = [];
  const before = Object.keys(previous.products).length;
  const after = Object.keys(next.products).length;
  if (before > 0 && after < before * 0.9) {
    problems.push(`index shrinks from ${before} to ${after} products (more than 10 %)`);
  }
  const counts = Object.entries(releaseCounts);
  const lost = counts.filter(([, c]) => c.after < c.before).map(([id]) => id);
  if (counts.length > 0 && lost.length / counts.length > 0.2) {
    problems.push(
      `${lost.length} of ${counts.length} products lost releases (more than 20 %): ${lost.slice(0, 10).join(', ')}`,
    );
  }
  return problems;
}
