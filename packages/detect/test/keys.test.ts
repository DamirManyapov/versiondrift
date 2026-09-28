import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import { describe, expect, it } from 'vitest';
import { generateSshKey } from '../src/index.ts';

describe('generateSshKey', () => {
  const { privateKey, publicKey } = generateSshKey();

  it('writes a private key SSH clients read, and its authorized_keys line', () => {
    const parsed = ssh2.utils.parseKey(privateKey);
    if (parsed instanceof Error) throw parsed;
    expect(parsed.type).toBe('ssh-ed25519');
    expect(`ssh-ed25519 ${parsed.getPublicSSH().toString('base64')} versiondrift`).toBe(publicKey);
  });

  it('agrees with ssh-keygen where it is installed', () => {
    let keygen = true;
    try {
      execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' });
    } catch (error) {
      keygen = (error as { status?: number }).status !== undefined; // "-?" exits non-zero but ran
    }
    if (!keygen) return;
    const dir = mkdtempSync(path.join(tmpdir(), 'vd-key-'));
    const file = path.join(dir, 'id');
    writeFileSync(file, privateKey, { mode: 0o600 });
    // ssh-keygen -y prints the key with the comment stored in the private key.
    expect(execFileSync('ssh-keygen', ['-y', '-f', file]).toString().trim()).toBe(publicKey);
  });
});
