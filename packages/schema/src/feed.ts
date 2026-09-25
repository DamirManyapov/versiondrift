// Feed JSON (docs/03-feed-format.md): what the collector publishes and every client reads.
import { z } from 'zod';

export const ITEM_TYPES = ['security', 'breaking', 'deprecated', 'feature', 'fix', 'other'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/**
 * Who decided an item's type (CLAUDE.md: every automatic judgement is labelled): a release-note heading, a keyword
 * rule, an LLM, a human, a linked advisory — or `default` when nothing matched and the item stays `other`.
 */
export const CLASSIFIED_BY = ['section', 'keyword', 'llm', 'manual', 'advisory', 'default'] as const;
export type ClassifiedBy = (typeof CLASSIFIED_BY)[number];

export const ChangeItem = z.strictObject({
  type: z.enum(ITEM_TYPES),
  /** One bullet, at most 300 characters, as the vendor wrote it (trimmed, links reduced to their text). */
  text: z.string().min(1).max(300),
  /** CVE / GHSA ids mentioned in the item. */
  refs: z.array(z.string()).optional(),
  classifiedBy: z.enum(CLASSIFIED_BY),
});
export type ChangeItem = z.output<typeof ChangeItem>;
