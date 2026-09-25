// S1-T8: the comment on module PRs — what the collector makes of each changed module (docs/04 "module-pr.yml").
import type { ItemType, Module } from '@versiondrift/schema';
import type { ModuleOutcome } from './run.ts';

export const REPORT_MARKER = '<!-- versiondrift-module-report -->';

const esc = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');

function typeSummary(types: ItemType[]): string {
  if (types.length === 0) return '—';
  const counts = new Map<ItemType, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${t} ${n}`).join(', ');
}

export function moduleReport(
  outcomes: ModuleOutcome[],
  modules: Module[],
  published: ReadonlySet<string>,
): string {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const lines = [REPORT_MARKER, '## VersionDrift module check', ''];
  for (const { id, result } of outcomes) {
    const module = byId.get(id);
    const product = result.product;
    const status = result.ok ? '✅' : '❌';
    const count = product ? `${product.releases.length} releases` : 'no data';
    const isNew = published.has(id) ? '' : ' · new module';
    lines.push(`### ${status} \`${id}\` — ${count}${isNew}`, '');
    if (!result.ok) lines.push(`**Collection failed:** ${esc(result.error)}`, '');
    if (product && result.ok) {
      lines.push('| Version | Date | Track | Items |', '|---|---|---|---|');
      for (const r of product.releases.slice(0, 5)) {
        const date = (r.date ?? r.firstSeenAt).slice(0, 10) + (r.date ? '' : ' (first seen)');
        const version = r.url ? `[${esc(r.version)}](${r.url})` : esc(r.version);
        lines.push(
          `| ${version}${r.prerelease ? ' (pre)' : ''} | ${date} | ${r.track ?? '—'} | ${r.items.length}: ${typeSummary(r.items.map((i) => i.type))} |`,
        );
      }
      lines.push('');
      const tracks = module?.tracks?.map((t) => t.id).join(', ');
      lines.push(`- **Tracks:** ${tracks || 'none (single release line)'}`);
      const branches = product.branches
        .slice(0, 5)
        .map((b) => `${b.id}${b.eol ? ' (EOL)' : b.eolDate ? ` (EOL ${b.eolDate})` : ''}`);
      lines.push(
        `- **Lifecycle:** ${branches.length ? `${branches.join(', ')}${product.branches.length > 5 ? ', …' : ''}` : 'no lifecycle source (EOL status unknown)'}`,
      );
      const security = module?.sources.security?.map((s) => s.type) ?? [];
      lines.push(
        `- **Security sources:** ${security.length ? security.join(', ') : '⚠️ none — the product page will say "security data not available"'}`,
      );
      const withoutDate = product.releases.filter((r) => r.date === null).length;
      if (withoutDate > 0) lines.push(`- **Releases without a date:** ${withoutDate} (shown as first seen)`);
    }
    for (const warning of result.warnings) lines.push(`- ⚠️ ${esc(warning)}`);
    lines.push('');
  }
  lines.push(
    '<sub>Parsed by the collector from `main` with the module files of this PR. Re-runs on every push. ',
    'Locally: `pnpm collect --only <id> --dry-run`.</sub>',
  );
  return lines.join('\n') + '\n';
}

/** Creates the report comment, or updates the one posted before (found by REPORT_MARKER). */
export async function upsertComment(
  repository: string,
  pr: number,
  body: string,
  token: string,
  doFetch: typeof fetch = fetch,
): Promise<'created' | 'updated'> {
  const api = (path: string, init: RequestInit = {}) =>
    doFetch(`https://api.github.com/repos/${repository}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
  const response = await api(`/issues/${pr}/comments?per_page=100`);
  if (!response.ok) throw new Error(`GitHub: listing comments failed (HTTP ${response.status})`);
  const comments = (await response.json()) as { id: number; body?: string }[];
  const existing = comments.find((c) => c.body?.includes(REPORT_MARKER));
  const result = existing
    ? await api(`/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
    : await api(`/issues/${pr}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  if (!result.ok) throw new Error(`GitHub: posting the report failed (HTTP ${result.status})`);
  return existing ? 'updated' : 'created';
}
