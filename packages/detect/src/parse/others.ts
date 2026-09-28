// RouterOS, Windows and Proxmox answers → products.
import type { Found } from '../types.ts';

/**
 * RouterOS `/system resource print`: "version: 7.23.7 (long-term)". The channel in brackets is the update channel
 * the router follows: the module's track "<major>-<channel>".
 */
export function parseRouterOs(resource: string): Found[] {
  const m = /^\s*version:\s*(\d+\.\d+(?:\.\d+)?(?:rc\d+|beta\d+)?)(?:\s*\(([a-z-]+)\))?/m.exec(resource);
  if (!m) return [{ productId: 'routeros', version: null, readRaw: resource.trim().slice(0, 500) }];
  const version = m[1]!;
  const channel = m[2];
  const major = version.split('.')[0]!;
  const track =
    channel === 'long-term' || channel === 'stable' || channel === 'testing'
      ? `${major}-${channel}`
      : undefined;
  return [{ productId: 'routeros', version, ...(track && { track }) }];
}

/** Windows `ver`: "Microsoft Windows [Version 10.0.20348.5622]" → the build as winver shows it, 20348.5622. */
export function parseWindowsVer(text: string): Found[] {
  const m = /\[Version \d+\.\d+\.(\d+)\.(\d+)\]/.exec(text);
  if (!m) return [{ productId: 'windows-server', version: null, readRaw: text.trim().slice(0, 500) }];
  return [{ productId: 'windows-server', version: `${m[1]}.${m[2]}` }];
}

/**
 * Proxmox `GET /api2/json/version`. VE answers the pve-manager version ("9.2.20"); Backup Server answers
 * "4.2" with release "6", which is 4.2.6.
 */
export function parseProxmoxVersion(body: unknown, product: 'pve' | 'pbs'): Found[] {
  const data = (body as { data?: { version?: unknown; release?: unknown } } | undefined)?.data;
  const version = typeof data?.version === 'string' ? data.version : null;
  const release =
    typeof data?.release === 'string' || typeof data?.release === 'number' ? String(data.release) : null;
  const productId = product === 'pve' ? 'proxmox-ve' : 'proxmox-backup-server';
  if (!version) return [{ productId, version: null, readRaw: JSON.stringify(body).slice(0, 500) }];
  if (product === 'pbs' && /^\d+\.\d+$/.test(version) && release && /^\d+$/.test(release))
    return [{ productId, version: `${version}.${release}` }];
  return [{ productId, version }];
}
