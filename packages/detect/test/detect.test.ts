import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detect, generateSshKey, type Target } from '../src/index.ts';

// An SSH server in the test process: password "pw" for versiondrift, or the client key below; each command answers
// with a recorded output.
const hostKey = generateSshKey('host').privateKey;
const clientKey = generateSshKey();
const allowed = ssh2.utils.parseKey(clientKey.publicKey) as ssh2.ParsedKey;
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
const OUTPUTS: Record<string, string> = {
  'cmd /c ver': fixture('windows-ver.txt'),
  '/system resource print': fixture('routeros-7.txt'),
  'versiondrift-inventory': fixture('linux-debian12.txt'),
};

let server: ssh2.Server;
let port = 0;
beforeAll(async () => {
  server = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.username !== 'versiondrift') return ctx.reject();
      if (ctx.method === 'password' && ctx.password === 'pw') return ctx.accept();
      if (
        ctx.method === 'publickey' &&
        ctx.key.algo === allowed.type &&
        Buffer.compare(ctx.key.data, allowed.getPublicSSH()) === 0
      ) {
        if (ctx.signature && !allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo)) return ctx.reject();
        return ctx.accept();
      }
      ctx.reject();
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        accept().once('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          stream.write(OUTPUTS[info.command] ?? 'bad command name');
          stream.exit(0);
          stream.end();
        });
      });
    });
    client.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

const target = (kind: Target['kind']): Target => ({ name: 'test', address: '127.0.0.1', port, kind });
const password = { username: 'versiondrift', secret: 'pw', privateKey: null };

describe('detect over SSH', () => {
  it('Windows: the build over SSH, and the host key it pinned', async () => {
    const result = await detect(target('windows'), password);
    expect(result).toMatchObject({
      ok: true,
      found: [{ productId: 'windows-server', version: '20348.5622' }],
      pins: { hostKey: expect.stringMatching(/^SHA256:/) as unknown },
    });
  });

  it('refuses a changed host key, and a refused login is auth-failed', async () => {
    const first = await detect(target('routeros'), password);
    if (!first.ok) throw new Error(first.message);
    expect(first.found).toEqual([{ productId: 'routeros', version: '7.23.7', track: '7-long-term' }]);
    expect((await detect(target('routeros'), password, { hostKey: first.pins!.hostKey! })).ok).toBe(true);
    expect(await detect(target('routeros'), password, { hostKey: 'SHA256:somethingelse' })).toMatchObject({
      ok: false,
      state: 'unreachable',
      code: 'host_key_mismatch',
    });
    expect(await detect(target('windows'), { ...password, secret: 'wrong' })).toMatchObject({
      ok: false,
      state: 'auth-failed',
      code: 'auth_denied',
    });
  });

  it('Linux: the instance key, the inventory parsed', async () => {
    const result = await detect(target('ssh-linux'), {
      username: 'versiondrift',
      secret: null,
      privateKey: clientKey.privateKey,
    });
    expect(result.ok && result.found.map((f) => `${f.productId} ${f.version}`)).toEqual([
      'debian 12.12',
      'docker-engine 29.7.2',
      'postgresql 16.10',
      'zabbix 7.0.29',
      'containerd 1.7.28',
    ]);
  });

  it('a closed port is unreachable', async () => {
    const closed = { ...target('windows'), port: 1 };
    expect(await detect(closed, password, {}, { timeoutMs: 3000 })).toMatchObject({
      ok: false,
      state: 'unreachable',
    });
  });
});

// Proxmox over HTTPS with a self-signed certificate (made with openssl where it is installed).
describe('detect over the Proxmox API', () => {
  let tls: { key: Buffer; cert: Buffer } | undefined;
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'vd-tls-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=pve',
        '-keyout',
        path.join(dir, 'key.pem'),
        '-out',
        path.join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    tls = { key: readFileSync(path.join(dir, 'key.pem')), cert: readFileSync(path.join(dir, 'cert.pem')) };
  } catch {
    tls = undefined;
  }

  it.skipIf(!tls)(
    'reads the version with the token, pins the certificate, refuses a wrong token',
    async () => {
      const api = https.createServer(tls!, (request, response) => {
        const ok = request.headers.authorization === 'PVEAPIToken=versiondrift@pve!vd=secret';
        response.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify(ok ? { data: { version: '9.2.20', release: '9.2', repoid: 'x' } } : { data: null }),
        );
      });
      await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
      const pve: Target = {
        name: 'pve',
        address: '127.0.0.1',
        port: (api.address() as AddressInfo).port,
        kind: 'proxmox',
      };
      const token = { username: 'versiondrift@pve!vd', secret: 'secret', privateKey: null };
      try {
        const first = await detect(pve, token);
        expect(first).toMatchObject({ ok: true, found: [{ productId: 'proxmox-ve', version: '9.2.20' }] });
        const pin = first.ok ? first.pins!.tlsFingerprint! : '';
        expect(pin).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
        expect((await detect(pve, token, { tlsFingerprint: pin })).ok).toBe(true);
        expect(await detect(pve, token, { tlsFingerprint: 'AA:BB' })).toMatchObject({
          ok: false,
          code: 'tls_mismatch',
        });
        expect(await detect(pve, { ...token, secret: 'nope' })).toMatchObject({
          ok: false,
          state: 'auth-failed',
        });
      } finally {
        api.close();
      }
    },
  );
});
