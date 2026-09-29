// One detector per host kind (ADR-0007): Linux runs the inventory script, Windows `ver`, RouterOS
// `/system resource print` (all over SSH); Proxmox answers its API with a read-only token.
import { parseLinuxInventory } from './parse/linux.ts';
import { parseProxmoxVersion, parseRouterOs, parseWindowsVer } from './parse/others.ts';
import { DetectError, httpsJson, sshExec } from './transport.ts';
import type { Credentials, Detection, Found, Pins, Target } from './types.ts';

const COMMANDS = {
  'ssh-linux': 'versiondrift-inventory',
  windows: 'cmd /c ver',
  routeros: '/system resource print',
} as const;

async function read(target: Target, credentials: Credentials, pins: Pins, timeoutMs?: number) {
  if (target.kind === 'proxmox') {
    // A Backup Server token is user@pbs!name and its header differs; ports 8006 (VE) and 8007 (Backup Server).
    const pbs = /@pbs!/.test(credentials.username);
    const port = target.port ?? (pbs ? 8007 : 8006);
    const auth = pbs
      ? `PBSAPIToken=${credentials.username}:${credentials.secret ?? ''}`
      : `PVEAPIToken=${credentials.username}=${credentials.secret ?? ''}`;
    const { body, fingerprint } = await httpsJson(
      `https://${target.address.includes(':') ? `[${target.address}]` : target.address}:${port}/api2/json/version`,
      { authorization: auth, accept: 'application/json' },
      { fingerprint: pins.tlsFingerprint ?? null, ...(timeoutMs && { timeoutMs }) },
    );
    return { found: parseProxmoxVersion(body, pbs ? 'pbs' : 'pve'), pins: { tlsFingerprint: fingerprint } };
  }
  const { output, hostKey } = await sshExec(target, credentials, COMMANDS[target.kind], {
    hostKey: pins.hostKey ?? null,
    ...(timeoutMs && { timeoutMs }),
  });
  const found: Found[] =
    target.kind === 'ssh-linux'
      ? parseLinuxInventory(output)
      : target.kind === 'windows'
        ? parseWindowsVer(output)
        : parseRouterOs(output);
  return { found, pins: { hostKey } };
}

export async function detect(
  target: Target,
  credentials: Credentials,
  pins: Pins = {},
  options: { timeoutMs?: number } = {},
): Promise<Detection> {
  try {
    const { found, pins: seen } = await read(target, credentials, pins, options.timeoutMs);
    if (found.length === 0 || found.every((f) => f.version === null))
      return {
        ok: false,
        state: 'unknown',
        code: 'unrecognized_version',
        message:
          found
            .map((f) => f.readRaw)
            .filter(Boolean)
            .join(' · ') || 'Nothing recognized in the answer',
      };
    return { ok: true, found, pins: seen };
  } catch (error) {
    if (error instanceof DetectError)
      return { ok: false, state: error.state, code: error.code, message: error.message };
    return { ok: false, state: 'unreachable', code: 'error', message: (error as Error).message };
  }
}
