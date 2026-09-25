// Release notes (Markdown / HTML / text) → a flat list of headings, bullets and prose paragraphs.
import * as cheerio from 'cheerio';
import { marked, type Token, type Tokens } from 'marked';

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'prose'; text: string };

/** A line that is only bold text (or ends with a colon) acts as a heading: "**Bug fixes**", "Changes:". */
const PSEUDO_HEADING = /^(?:\*\*|__)([^*_]{2,60})(?:\*\*|__):?$|^([A-Z][\w &/-]{1,40}):$/;

function inlineMarkdownToText(md: string): string {
  return (
    md
      // GitHub PR / issue / author references: "[#123](…)", "[@user[bot]](…)", "by @user in https://…/pull/1".
      .replace(/,?\s*\[#\d+\]\([^)]*\)/g, '')
      .replace(/,?\s*\[@[^\]]*?(?:\[[^\]]*\])?\]\([^)]*\)/g, '')
      .replace(/\s+by @[\w-]+(?:\[bot\])? in https?:\/\/\S+/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
      .replace(/<[^>]+>/g, '') // inline html
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
  );
}

function fromMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const walkList = (list: Tokens.List) => {
    for (const item of list.items) {
      const own = item.tokens
        .filter((t) => t.type !== 'list')
        .map((t) => t.raw)
        .join('\n');
      // A bold line right after a bullet (no blank line) is glued to it by Markdown; it is really a heading.
      let lines: string[] = [];
      const flush = () => {
        if (lines.length) blocks.push({ kind: 'bullet', text: inlineMarkdownToText(lines.join(' ')) });
        lines = [];
      };
      for (const line of own.split('\n')) {
        const pseudo = PSEUDO_HEADING.exec(line.trim());
        if (pseudo && /^(\*\*|__)/.test(line.trim())) {
          flush();
          blocks.push({ kind: 'heading', level: 7, text: pseudo[1] ?? line });
        } else {
          lines.push(line);
        }
      }
      flush();
      for (const nested of item.tokens) if (nested.type === 'list') walkList(nested as Tokens.List);
    }
  };
  const walk = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === 'heading') {
        const heading = token as Tokens.Heading;
        blocks.push({ kind: 'heading', level: heading.depth, text: inlineMarkdownToText(heading.text) });
      } else if (token.type === 'list') {
        walkList(token as Tokens.List);
      } else if (token.type === 'paragraph') {
        const raw = (token as Tokens.Paragraph).text.trim();
        const pseudo = PSEUDO_HEADING.exec(raw);
        if (pseudo) blocks.push({ kind: 'heading', level: 7, text: pseudo[1] ?? pseudo[2] ?? raw });
        else blocks.push({ kind: 'prose', text: inlineMarkdownToText(raw) });
      } else if (token.type === 'html') {
        blocks.push(...fromHtml((token as Tokens.HTML).text));
      } else if (token.type === 'blockquote') {
        walk((token as Tokens.Blockquote).tokens);
      }
    }
  };
  walk(marked.lexer(md));
  return blocks;
}

function fromHtml(html: string): Block[] {
  const $ = cheerio.load(html);
  $('script, style, img, details > summary').remove();
  const hasStructure = $('li, p, h1, h2, h3, h4, h5, h6').length > 0;
  if (!hasStructure) {
    // "line<br>*) item;<br>" feeds (MikroTik): treat as text.
    return fromText(cheerio.load(($('body').html() ?? html).replace(/<br\s*\/?>/gi, '\n')).text());
  }
  const blocks: Block[] = [];
  $('h1, h2, h3, h4, h5, h6, li, p').each((_, node) => {
    const el = $(node);
    if (el.is('li')) {
      const own = el.clone();
      own.find('ul, ol').remove();
      blocks.push({ kind: 'bullet', text: own.text() });
    } else if (el.is('p')) {
      if (el.parents('li').length > 0) return;
      const text = el.text().trim();
      const onlyStrong =
        el.children().length === 1 &&
        el.children().first().is('strong, b') &&
        el.children().first().text().trim() === text;
      blocks.push(onlyStrong ? { kind: 'heading', level: 7, text } : { kind: 'prose', text });
    } else {
      blocks.push({ kind: 'heading', level: Number(node.tagName.slice(1)), text: el.text() });
    }
  });
  return blocks;
}

const BULLET = /^\s*(?:[-*•+]|\*\)|\d+[.)])\s+(.*)$/;
/** MikroTik-style "*) item" lines: when present, other list-looking lines are instructions, not changes. */
const STAR_PAREN = /^\s*\*\)\s+/;

function fromText(text: string): Block[] {
  const blocks: Block[] = [];
  const starParenOnly = text.split(/\r?\n/).some((line) => STAR_PAREN.test(line));
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) blocks.push({ kind: 'prose', text: prose.join(' ') });
    prose = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const bullet = BULLET.exec(line);
    if (bullet && starParenOnly && !STAR_PAREN.test(line)) {
      flush();
    } else if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', text: bullet[1]! });
    } else if (line.trim() === '') {
      flush();
    } else if (PSEUDO_HEADING.test(line.trim()) && line.trim().length <= 40) {
      flush();
      blocks.push({ kind: 'heading', level: 7, text: line.trim().replace(/:$/, '') });
    } else {
      prose.push(line.trim());
    }
  }
  flush();
  return blocks;
}

export function toBlocks(format: 'markdown' | 'html' | 'text', body: string): Block[] {
  const blocks =
    format === 'markdown' ? fromMarkdown(body) : format === 'html' ? fromHtml(body) : fromText(body);
  return blocks.map((b) => ({ ...b, text: b.text.replace(/\s+/g, ' ').trim() })).filter((b) => b.text !== '');
}
