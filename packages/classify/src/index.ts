import { ITEM_TYPES, type ChangeItem, type ItemType } from '@versiondrift/schema';
import { toBlocks } from './blocks.ts';
import {
  keywordType,
  NOISE_ITEM,
  refsIn,
  sectionMeaning,
  type ClassifyHints,
  type SectionMeaning,
} from './rules.ts';

export type { ClassifyHints } from './rules.ts';
export { toBlocks, type Block } from './blocks.ts';

/** Bump when the rules change enough that published items should be recomputed (see moduleHash in the feed). */
export const CLASSIFIER_VERSION = '3';

export const MAX_ITEM_LENGTH = 300;
export const MAX_ITEMS = 40;
const MAX_PROSE_ITEMS = 3;

export interface ReleaseNotesInput {
  format: 'markdown' | 'html' | 'text';
  body: string;
}

export interface Classified {
  items: ChangeItem[];
  /** Items left out to stay within MAX_ITEMS (the least important ones). */
  omitted: number;
}

function shorten(text: string): string {
  const clean = text.replace(/^[-–—:;,.\s]+/, '').replace(/[\s,;]+$/, '');
  if (clean.length <= MAX_ITEM_LENGTH) return clean;
  const cut = clean.slice(0, MAX_ITEM_LENGTH - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_ITEM_LENGTH / 2)).trimEnd()}…`;
}

function classifyText(text: string, section: SectionMeaning, hints: ClassifyHints | undefined): ChangeItem {
  const refs = refsIn(text);
  const withRefs = (item: Omit<ChangeItem, 'refs'>): ChangeItem => ({
    ...item,
    ...(refs.length > 0 && { refs }),
  });
  // A CVE/GHSA id is the strongest signal there is, whatever section the vendor put it in.
  if (refs.length > 0 && !(typeof section === 'object' && section.type === 'security')) {
    return withRefs({ type: 'security', text: shorten(text), classifiedBy: 'keyword' });
  }
  if (typeof section === 'object' && section.type !== 'other') {
    return withRefs({ type: section.type, text: shorten(text), classifiedBy: 'section' });
  }
  const byKeyword = keywordType(text, hints);
  if (byKeyword) return withRefs({ type: byKeyword, text: shorten(text), classifiedBy: 'keyword' });
  return withRefs({
    type: 'other',
    text: shorten(text),
    classifiedBy: typeof section === 'object' ? 'section' : 'default',
  });
}

const PRIORITY: Record<ItemType, number> = Object.fromEntries(ITEM_TYPES.map((t, i) => [t, i])) as Record<
  ItemType,
  number
>;

/** Release notes → typed items (docs/04 "Classification pipeline", steps 1–3 and 5; the LLM step comes in S3). */
export function classifyNotes(notes: ReleaseNotesInput | undefined, hints?: ClassifyHints): Classified {
  if (!notes || notes.body.trim() === '') return { items: [], omitted: 0 };
  const blocks = toBlocks(notes.format, notes.body);
  const hasBullets = blocks.some((b) => b.kind === 'bullet');

  const items: ChangeItem[] = [];
  const sections: { level: number; meaning: SectionMeaning }[] = [];
  let prose = 0;
  for (const block of blocks) {
    if (block.kind === 'heading') {
      while (sections.length > 0 && sections[sections.length - 1]!.level >= block.level) sections.pop();
      sections.push({ level: block.level, meaning: sectionMeaning(block.text, hints) });
      continue;
    }
    // Prose counts only when the notes have no bullets at all (a short announcement) — or when it names a CVE.
    const namesCve = refsIn(block.text).length > 0;
    if (block.kind === 'prose' && !namesCve && (hasBullets || prose++ >= MAX_PROSE_ITEMS)) continue;
    const section = [...sections].reverse().find((s) => s.meaning !== undefined)?.meaning;
    if (section === 'noise' || NOISE_ITEM.test(block.text)) continue;
    items.push(classifyText(block.text, section, hints));
  }

  const seen = new Set<string>();
  const unique = items.filter((item) => {
    const key = item.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length <= MAX_ITEMS) return { items: unique, omitted: 0 };
  const keep = new Set(
    unique
      .map((item, index) => ({ item, index }))
      .sort((a, b) => PRIORITY[a.item.type] - PRIORITY[b.item.type] || a.index - b.index)
      .slice(0, MAX_ITEMS)
      .map((x) => x.index),
  );
  return { items: unique.filter((_, i) => keep.has(i)), omitted: unique.length - MAX_ITEMS };
}
