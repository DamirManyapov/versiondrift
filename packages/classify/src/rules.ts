// Section headings and keywords that decide an item's type (docs/04-collector.md "Classification pipeline").
import type { HintType, ItemType } from '@versiondrift/schema';

/** Hints from a module's `classify` block. */
export interface ClassifyHints {
  sections?: Partial<Record<HintType, string[]>>;
  keywords?: Partial<Record<HintType, string[]>>;
}

/** Order matters: the first type whose term occurs in a heading wins ("Security fixes" → security). */
const SECTION_TERMS: [ItemType, string[]][] = [
  ['security', ['security', 'vulnerabilities', 'vulnerability', 'cve', 'cves']],
  [
    'breaking',
    [
      'breaking',
      'backwards incompatible',
      'backward incompatible',
      'incompatible',
      'removed',
      'removals',
      'upgrade notes',
      'migration notes',
    ],
  ],
  ['deprecated', ['deprecated', 'deprecations', 'deprecation']],
  ['fix', ['fixed', 'fixes', 'fix', 'bug fixes', 'bugfixes', 'bugs']],
  [
    'feature',
    ['features', 'feature', 'enhancements', 'improvements', 'added', 'new', "what's new", 'highlights'],
  ],
  [
    'other',
    [
      'changed',
      'changes',
      'dependencies',
      'dependency updates',
      'chores',
      'maintenance',
      'documentation',
      'docs',
      'internal',
      'misc',
      'miscellaneous',
      'other',
      'refactoring',
      'performance',
    ],
  ],
];

/** Sections whose bullets are not changes at all. */
const NOISE_SECTION =
  /\b(new contributors|contributors|acknowledg(e)?ments|thanks|checksums|assets|downloads?|installation|full changelog)\b/;

/** Order matters as above; CVE/GHSA ids are handled separately (they always mean security). */
const KEYWORD_RULES: [ItemType, RegExp][] = [
  [
    'security',
    /\b(?:security|vulnerab\w*|XSS|CSRF|SSRF|RCE|remote code execution|privilege escalation|sql injection|path traversal|denial[- ]of[- ]service)\b/i,
  ],
  [
    'breaking',
    // "Removed X" as the item's verb or removing support is breaking; "remove unnecessary checks" in the
    // middle of a sentence is not ("fix: remove …" is caught earlier by the Conventional Commits prefix).
    /(?:^|[:–—]\s+)remov(?:e|ed|es)\b|\b(?:breaking(?: changes?)?|no longer support\w*|(?:removed?|drop(?:ped|s)?) support|removal of|incompatib\w*|(?:has|have|is|are|was|were) (?:been )?removed)\b/i,
  ],
  ['deprecated', /\bdeprecat\w*/i],
  // "fix" only as the verb of the item ("Fix …", "Alerting: fix …", "fixed the …"), not "a fixed offset";
  // "(introduced in 7.24.3)" is MikroTik's marker for a regression fix.
  [
    'fix',
    /(?:^|[:–—-]\s+)fix(?:e[sd])?\b|\bfix(?:e[sd])? (?:a|an|the|for|issue|bug|crash|problem|regression|incorrect|wrong|missing)\b|\bbug(?:fix)?s?\b|\bcrash(?:es|ed|ing)?\b|\bregressions?\b|\(introduced in\b/i,
  ],
  ['feature', /\b(?:adds?|added|new|introduc\w+|supports? for|implement\w*|allows?)\b/i],
];

const REF = /\b(?:CVE-\d{4}-\d{4,}|GHSA(?:-[0-9a-z]{4}){3})\b/gi;

export function refsIn(text: string): string[] {
  const refs = (text.match(REF) ?? []).map((r) =>
    r.toUpperCase().startsWith('CVE') ? r.toUpperCase() : `GHSA${r.slice(4).toLowerCase()}`,
  );
  return [...new Set(refs)];
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const containsTerm = (heading: string, term: string) => ` ${heading} `.includes(` ${normalize(term)} `);

export type SectionMeaning = { type: ItemType; byModule: boolean } | 'noise' | undefined;

export function sectionMeaning(heading: string, hints: ClassifyHints | undefined): SectionMeaning {
  const h = normalize(heading);
  for (const [type, terms] of Object.entries(hints?.sections ?? {}) as [HintType, string[]][]) {
    if (terms.some((term) => normalize(term) === h || containsTerm(h, term))) return { type, byModule: true };
  }
  if (NOISE_SECTION.test(h)) return 'noise';
  for (const [type, terms] of SECTION_TERMS) {
    if (terms.some((term) => containsTerm(h, term))) return { type, byModule: false };
  }
  return undefined;
}

/** Conventional Commits prefixes ("fix(api): …", "feat!: …") say what the change is. */
const CONVENTIONAL =
  /^(fix|feat|perf|docs|chore|refactor|test|tests|ci|build|style|revert)(\([^)]*\))?(!)?:\s/i;

export function keywordType(text: string, hints: ClassifyHints | undefined): ItemType | undefined {
  const lower = text.toLowerCase();
  const conventional = CONVENTIONAL.exec(text);
  if (conventional) {
    if (conventional[3] || /BREAKING CHANGE/.test(text)) return 'breaking';
    const kind = conventional[1]!.toLowerCase();
    if (kind === 'fix') return /\b(?:security|CVE-|vulnerab)/i.test(text) ? 'security' : 'fix';
    if (kind === 'feat') return 'feature';
    if (kind === 'perf') return 'feature';
    return 'other';
  }
  for (const [type, words] of Object.entries(hints?.keywords ?? {}) as [HintType, string[]][]) {
    if (words.some((word) => lower.includes(word.toLowerCase()))) return type;
  }
  return KEYWORD_RULES.find(([, re]) => re.test(text))?.[0];
}

/** Lines that are links or boilerplate, not changes ("Downloads: https://… Release notes: https://…" included). */
export const NOISE_ITEM =
  /^(?:download(?: page)?|what'?s new(?: highlights)?|full changelog|release notes|changelog|new contributors|see (?:the )?(?:full )?(?:changelog|release notes))\b|^(?:[\w' ]{0,40}:?\s*https?:\/\/\S+\s*)+$|^\S+ is the latest (?:release|version)\b/i;
