// Linux: the output of versiondrift-inventory (apps/web/static/downloads): /etc/os-release, /etc/debian_version and
// the installed packages. The OS point release and the packages that are products (a small table until the modules
// carry their own package names, S6-T4).
import type { Found } from '../types.ts';
import { upstreamVersion } from './version.ts';

function sections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current = '';
  for (const line of text.split(/\r?\n/)) {
    const head = /^### (\S+)/.exec(line);
    if (head) {
      current = head[1]!;
      out.set(current, []);
    } else if (current) out.get(current)!.push(line);
  }
  return out;
}

function osRelease(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    const m = /^([A-Z_]+)=(?:"(.*)"|(.*))$/.exec(line.trim());
    if (m) out[m[1]!] = m[2] ?? m[3] ?? '';
  }
  return out;
}

/** Package name → product; the first match of a product wins (a server before its agent). */
const PACKAGES: { match: RegExp; productId: string; label?: string }[] = [
  { match: /^docker-ce$/, productId: 'docker-engine' },
  { match: /^docker\.io$/, productId: 'docker-engine' },
  { match: /^postgresql-\d+$/, productId: 'postgresql' },
  { match: /^nginx$/, productId: 'nginx' },
  { match: /^zabbix-server-(pgsql|mysql)$/, productId: 'zabbix', label: 'Zabbix server' },
  { match: /^zabbix-proxy-(pgsql|mysql|sqlite3)$/, productId: 'zabbix', label: 'Zabbix proxy' },
  { match: /^zabbix-agent2?$/, productId: 'zabbix', label: 'Zabbix agent' },
  { match: /^pve-manager$/, productId: 'proxmox-ve' },
  { match: /^proxmox-backup-server$/, productId: 'proxmox-backup-server' },
  { match: /^grafana(-enterprise)?$/, productId: 'grafana' },
  { match: /^redis-server$/, productId: 'redis' },
  { match: /^mariadb-server$/, productId: 'mariadb' },
  { match: /^mysql-server$/, productId: 'mysql' },
  { match: /^haproxy$/, productId: 'haproxy' },
  { match: /^postfix$/, productId: 'postfix' },
  { match: /^dovecot-core$/, productId: 'dovecot' },
  { match: /^elasticsearch$/, productId: 'elasticsearch' },
  { match: /^kibana$/, productId: 'kibana' },
  { match: /^prometheus$/, productId: 'prometheus' },
  { match: /^caddy$/, productId: 'caddy' },
  { match: /^containerd\.io$/, productId: 'containerd' },
];

/** Debian / Ubuntu point releases come from their own files; other distributions from VERSION_ID. */
function operatingSystem(os: Record<string, string>, debianVersion: string | undefined): Found | undefined {
  const id = os.ID?.toLowerCase();
  if (!id) return undefined;
  if (id === 'debian') {
    const version = debianVersion && /^\d+\.\d+$/.test(debianVersion) ? debianVersion : null;
    return version
      ? { productId: 'debian', version }
      : { productId: 'debian', version: null, readRaw: `debian_version: ${debianVersion ?? '—'}` };
  }
  if (id === 'ubuntu') {
    const version = /^\d+\.\d+(?:\.\d+)?/.exec(os.VERSION ?? '')?.[0] ?? os.VERSION_ID ?? null;
    return { productId: 'ubuntu', version };
  }
  const product: Record<string, string> = {
    rocky: 'rocky-linux',
    almalinux: 'almalinux',
    rhel: 'rhel',
    alpine: 'alpine-linux',
  };
  return product[id] ? { productId: product[id], version: os.VERSION_ID ?? null } : undefined;
}

export function parseLinuxInventory(text: string): Found[] {
  const parts = sections(text);
  const os = osRelease(parts.get('os-release') ?? []);
  const debianVersion = parts
    .get('debian_version')
    ?.find((l) => l.trim())
    ?.trim();
  const found: Found[] = [];
  const system = operatingSystem(os, debianVersion);
  if (system) found.push(system);

  const installed: { name: string; version: string }[] = [];
  for (const line of parts.get('dpkg') ?? []) {
    const [name, version, status] = line.split('\t');
    if (name && version && (status === undefined || status.startsWith('ii')))
      installed.push({ name, version });
  }
  for (const line of parts.get('rpm') ?? []) {
    const [name, version] = line.split('\t');
    if (name && version) installed.push({ name, version });
  }
  const seen = new Set(found.map((f) => f.productId));
  for (const rule of PACKAGES) {
    if (seen.has(rule.productId)) continue;
    const matches = installed.filter((p) => rule.match.test(p.name));
    // Several majors side by side (postgresql-15 and -16): the newest one.
    const best = matches
      .map((p) => upstreamVersion(p.version))
      .filter((v): v is string => v !== null)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    if (!best) continue;
    found.push({ productId: rule.productId, version: best, ...(rule.label && { label: rule.label }) });
    seen.add(rule.productId);
  }
  return found;
}
