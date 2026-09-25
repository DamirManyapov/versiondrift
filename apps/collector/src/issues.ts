// docs/04 failure policy: after 3 consecutive failures a module gets an issue (mentioning its maintainers);
// the issue is closed automatically once the module collects again.
import type { Health, Module } from '@versiondrift/schema';

export const BROKEN_LABEL = 'module-broken';
const FAILURE_THRESHOLD = 3;
const titleFor = (id: string) => `Module ${id} is failing`;

export interface GitHubIssues {
  listOpen(label: string): Promise<{ number: number; title: string }[]>;
  create(title: string, body: string, labels: string[]): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  close(number: number): Promise<void>;
}

export function githubIssues(repository: string, token: string, doFetch: typeof fetch = fetch): GitHubIssues {
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await doFetch(`https://api.github.com/repos/${repository}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: HTTP ${response.status}`);
    return response;
  };
  return {
    async listOpen(label) {
      const response = await api(`/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`);
      return (await response.json()) as { number: number; title: string }[];
    },
    async create(title, body, labels) {
      await api('/issues', { method: 'POST', body: JSON.stringify({ title, body, labels }) });
    },
    async comment(number, body) {
      await api(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    },
    async close(number) {
      await api(`/issues/${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      });
    },
  };
}

export async function syncModuleIssues(
  health: Health,
  modules: Module[],
  github: GitHubIssues,
  runUrl?: string,
): Promise<string[]> {
  const actions: string[] = [];
  const open = new Map((await github.listOpen(BROKEN_LABEL)).map((i) => [i.title, i.number]));
  const byId = new Map(modules.map((m) => [m.id, m]));
  for (const [id, entry] of Object.entries(health.modules)) {
    const existing = open.get(titleFor(id));
    if (entry.status === 'ok' && existing !== undefined) {
      await github.comment(
        existing,
        `Collected successfully again${runUrl ? ` in ${runUrl}` : ''}. Closing.`,
      );
      await github.close(existing);
      actions.push(`closed #${existing} (${id})`);
    } else if (
      entry.status === 'failed' &&
      entry.consecutiveFailures >= FAILURE_THRESHOLD &&
      existing === undefined
    ) {
      const maintainers = byId.get(id)?.maintainers ?? [];
      const body = [
        `Collection of \`products/${id}.yaml\` has failed ${entry.consecutiveFailures} times in a row.`,
        '',
        `**Error:** ${entry.error ?? 'unknown'}`,
        ...(entry.warnings.length ? ['', '**Warnings:**', ...entry.warnings.map((w) => `- ${w}`)] : []),
        '',
        `Last success: ${entry.lastSuccessAt ?? 'never'}. The feed keeps the last good data, marked stale.`,
        ...(runUrl ? [`Run: ${runUrl}`] : []),
        '',
        maintainers.length ? `cc ${maintainers.join(' ')}` : 'This module has no maintainers — help wanted.',
        '',
        `Reproduce: \`pnpm collect --only ${id} --dry-run\``,
      ].join('\n');
      await github.create(titleFor(id), body, [BROKEN_LABEL]);
      actions.push(`opened issue for ${id}`);
    }
  }
  return actions;
}
