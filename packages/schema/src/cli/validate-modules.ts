// pnpm modules:validate — checks every products/*.yaml. Exit code 1 if any module has an error.
// Output lines are "file:line:col: level: message" (clickable in terminals and editors);
// under GitHub Actions they are also emitted as annotations on the PR diff.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateModules, type ModuleIssue } from '../validate.ts';
import { PRODUCTS_DIR, REPO_ROOT } from './paths.ts';

const names = (await readdir(PRODUCTS_DIR))
  .filter((name) => name.endsWith('.yaml') && !name.endsWith('.releases.yaml'))
  .sort();
const files = await Promise.all(
  names.map(async (name) => {
    const full = path.join(PRODUCTS_DIR, name);
    return { file: path.relative(REPO_ROOT, full), text: await readFile(full, 'utf8') };
  }),
);

const annotate = process.env.GITHUB_ACTIONS === 'true';
const where = (file: string, i: ModuleIssue) =>
  i.line === undefined ? file : `${file}:${i.line}:${i.column ?? 1}`;

let errors = 0;
let warnings = 0;
for (const { file, issues } of validateModules(files)) {
  for (const issue of issues) {
    if (issue.level === 'error') errors++;
    else warnings++;
    const text = issue.path ? `${issue.path}: ${issue.message}` : issue.message;
    console.log(`${where(file, issue)}: ${issue.level}: ${text} [${issue.code}]`);
    if (annotate) {
      const pos = issue.line === undefined ? '' : `,line=${issue.line},col=${issue.column ?? 1}`;
      console.log(`::${issue.level} file=${file}${pos}::${text.replaceAll('\n', '%0A')}`);
    }
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
console.log(
  `${plural(files.length, 'module')} checked: ${plural(errors, 'error')}, ${plural(warnings, 'warning')}`,
);
process.exitCode = errors > 0 ? 1 : 0;
