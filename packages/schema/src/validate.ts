// Validation of products/*.yaml files: YAML syntax, the zod schema, and the rules that need the file name
// or the other modules (docs/02-module-spec.md "Validation rules"). Rules that need collected releases
// (every version parses, tracks don't overlap) belong to the collector.
import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, type Document } from 'yaml';
import type { z } from 'zod';
import { Module } from './module.ts';

export interface ModuleIssue {
  level: 'error' | 'warning';
  /** Stable machine-readable code: yaml, schema, idMismatch, aliasIsModuleId, noSecuritySource. */
  code: string;
  message: string;
  /** Where inside the module, e.g. "sources.releases.repo" or "tracks[1].id". */
  path?: string;
  /** 1-based position in the file. */
  line?: number;
  column?: number;
}

export interface ModuleFile {
  /** Path as it should appear in messages, e.g. "products/grafana.yaml". */
  file: string;
  text: string;
}

export interface ModuleFileResult {
  file: string;
  /** Present when the file passed the schema. */
  module?: Module;
  issues: ModuleIssue[];
}

type Path = (string | number)[];

// No node:path: this package also runs in browsers and Workers.
function baseName(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

/** Files like products/_template.yaml are examples: schema-checked, but not real modules. */
export function isTemplateFile(file: string): boolean {
  return baseName(file).startsWith('_');
}

export function formatPath(p: Path): string {
  return p.map((k, i) => (typeof k === 'number' ? `[${k}]` : i === 0 ? k : `.${k}`)).join('');
}

interface Parsed {
  doc: Document;
  lines: LineCounter;
}

/**
 * Position of the deepest part of `p` that exists in the file: the key for a map entry, the item for a
 * list entry. A missing key therefore points at the key of the object that should contain it.
 */
function locate({ doc, lines }: Parsed, p: Path): Pick<ModuleIssue, 'line' | 'column'> {
  let node: unknown = doc.contents;
  let offset = isNode(node) ? node.range?.[0] : undefined;
  for (const key of p) {
    if (isMap(node)) {
      const pair = node.items.find((item) => isScalar(item.key) && item.key.value === key);
      if (!pair) break;
      if (isNode(pair.key)) offset = pair.key.range?.[0] ?? offset;
      node = pair.value;
    } else if (isSeq(node) && typeof key === 'number') {
      const item: unknown = node.items[key];
      if (!isNode(item)) break;
      offset = item.range?.[0] ?? offset;
      node = item;
    } else {
      break;
    }
  }
  if (offset === undefined) return {};
  const { line, col } = lines.linePos(offset);
  return { line, column: col };
}

function schemaIssues(parsed: Parsed, error: z.ZodError): ModuleIssue[] {
  return error.issues.map((issue) => {
    const p = issue.path.filter((k): k is string | number => typeof k !== 'symbol');
    // For an unknown key, point at the key itself rather than at the object that contains it.
    const at = issue.code === 'unrecognized_keys' && issue.keys[0] !== undefined ? [...p, issue.keys[0]] : p;
    return {
      level: 'error',
      code: 'schema',
      message: issue.message,
      ...(p.length > 0 && { path: formatPath(p) }),
      ...locate(parsed, at),
    };
  });
}

function checkFile({ file, text }: ModuleFile): { result: ModuleFileResult; parsed?: Parsed } {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false });
  if (doc.errors.length > 0) {
    const issues = doc.errors.map((e): ModuleIssue => {
      const { line, col } = lines.linePos(e.pos[0]);
      return {
        level: 'error',
        code: 'yaml',
        message: e.message.split('\n')[0] ?? e.message,
        line,
        column: col,
      };
    });
    return { result: { file, issues } };
  }

  const parsed = { doc, lines };
  const outcome = Module.safeParse(doc.toJS());
  if (!outcome.success) return { result: { file, issues: schemaIssues(parsed, outcome.error) }, parsed };

  const module = outcome.data;
  const issues: ModuleIssue[] = [];
  if (!isTemplateFile(file)) {
    const expected = baseName(file).replace(/\.ya?ml$/, '');
    if (module.id !== expected) {
      issues.push({
        level: 'error',
        code: 'idMismatch',
        message: `id "${module.id}" must equal the file name "${expected}"`,
        path: 'id',
        ...locate(parsed, ['id']),
      });
    }
    if (!module.sources.security?.length) {
      issues.push({
        level: 'warning',
        code: 'noSecuritySource',
        message: 'no security source: the product page will say "security data not available"',
        path: 'sources',
        ...locate(parsed, ['sources']),
      });
    }
  }
  return { result: { file, module, issues }, parsed };
}

/** Validates one module file on its own (no cross-module rules). */
export function validateModuleFile(file: ModuleFile): ModuleFileResult {
  return checkFile(file).result;
}

/** Validates a set of module files, including rules across modules. Results keep the input order. */
export function validateModules(files: ModuleFile[]): ModuleFileResult[] {
  const checked = files.map(checkFile);

  const idOwners = new Map<string, string>();
  for (const { result } of checked) {
    if (result.module && !isTemplateFile(result.file)) idOwners.set(result.module.id, result.file);
  }
  for (const { result, parsed } of checked) {
    if (!result.module || !parsed || isTemplateFile(result.file)) continue;
    result.module.aliases?.forEach((alias, i) => {
      const owner = idOwners.get(alias);
      if (owner === undefined) return;
      result.issues.push({
        level: 'error',
        code: 'aliasIsModuleId',
        message:
          owner === result.file
            ? `alias "${alias}" repeats the module's own id`
            : `alias "${alias}" is the id of ${owner}`,
        path: `aliases[${i}]`,
        ...locate(parsed, ['aliases', i]),
      });
    });
  }
  return checked.map(({ result }) => result);
}
