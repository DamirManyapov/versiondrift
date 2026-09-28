// How detectors reach hosts: SSH (Linux, Windows, RouterOS) and HTTPS (the Proxmox API). The SSH host key and the TLS
// certificate are trusted on first use: the first successful contact pins them, a later change is refused.
import { createHash } from 'node:crypto';
import https from 'node:https';
import ssh2 from 'ssh2';
import type { Credentials, Target } from './types.ts';

export class DetectError extends Error {
  override name = 'DetectError';
  readonly state: 'unreachable' | 'auth-failed' | 'unknown';
  readonly code: string;

  constructor(state: DetectError['state'], code: string, message: string) {
    super(message);
    this.state = state;
    this.code = code;
  }
}

const NETWORK: Record<string, string> = {
  ECONNREFUSED: 'refused',
  ETIMEDOUT: 'timeout',
  EHOSTUNREACH: 'timeout',
  ENETUNREACH: 'timeout',
  ENOTFOUND: 'not_found',
  ECONNRESET: 'reset',
};

function networkError(error: Error & { code?: string }, target: Target): DetectError {
  const code = NETWORK[error.code ?? ''];
  if (code) return new DetectError('unreachable', code, `${target.address}: ${error.message}`);
  return new DetectError('unreachable', 'error', error.message);
}

export const sshFingerprint = (key: Buffer) =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

/** Runs one command over SSH and returns its output and the host key it saw. */
export function sshExec(
  target: Target,
  credentials: Credentials,
  command: string,
  options: { hostKey?: string | null; timeoutMs?: number } = {},
): Promise<{ output: string; hostKey: string }> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client();
    let seen = '';
    let settled = false;
    const finish = (error: DetectError | undefined, output = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      if (error) reject(error);
      else resolve({ output, hostKey: seen });
    };
    const timer = setTimeout(
      () =>
        finish(
          new DetectError('unreachable', 'timeout', `${target.address}: no answer in ${timeoutMs / 1000} s`),
        ),
      timeoutMs,
    );
    conn.on('ready', () => {
      conn.exec(command, (error, stream) => {
        if (error) return finish(new DetectError('unknown', 'exec_failed', error.message));
        let output = '';
        stream.on('data', (chunk: Buffer) => (output += chunk.toString()));
        stream.stderr.on('data', () => undefined);
        stream.on('close', () => finish(undefined, output));
      });
    });
    conn.on('error', (error: Error & { level?: string; code?: string }) => {
      if (options.hostKey && seen && seen !== options.hostKey)
        return finish(
          new DetectError(
            'unreachable',
            'host_key_mismatch',
            `${target.address}: the SSH host key changed (${seen}, expected ${options.hostKey})`,
          ),
        );
      if (error.level === 'client-authentication')
        return finish(
          new DetectError('auth-failed', 'auth_denied', `${target.address}: the login was refused`),
        );
      if (error.level === 'client-timeout')
        return finish(new DetectError('unreachable', 'timeout', `${target.address}: no answer`));
      finish(networkError(error, target));
    });
    conn.connect({
      host: target.address,
      port: target.port ?? 22,
      username: credentials.username,
      ...(credentials.privateKey
        ? { privateKey: credentials.privateKey }
        : { password: credentials.secret ?? '' }),
      readyTimeout: timeoutMs,
      tryKeyboard: false,
      hostVerifier: (key: Buffer) => {
        seen = sshFingerprint(key);
        return !options.hostKey || options.hostKey === seen;
      },
    });
  });
}

/** GET a JSON document over HTTPS, pinning the server certificate on first use (self-signed is the norm). */
export function httpsJson(
  url: string,
  headers: Record<string, string>,
  options: { fingerprint?: string | null; timeoutMs?: number } = {},
): Promise<{ body: unknown; fingerprint: string }> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const target = { address: new URL(url).hostname } as Target;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers, rejectUnauthorized: false, timeout: timeoutMs }, (response) => {
      const socket = response.socket as import('node:tls').TLSSocket;
      const fingerprint = socket.getPeerCertificate().fingerprint256 ?? '';
      if (options.fingerprint && fingerprint !== options.fingerprint) {
        response.resume();
        return reject(
          new DetectError(
            'unreachable',
            'tls_mismatch',
            `${target.address}: the TLS certificate changed (${fingerprint}, expected ${options.fingerprint})`,
          ),
        );
      }
      let text = '';
      response.on('data', (chunk: Buffer) => (text += chunk.toString()));
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        if (status === 401 || status === 403)
          return reject(
            new DetectError(
              'auth-failed',
              'auth_denied',
              `${target.address}: the token was refused (${status})`,
            ),
          );
        if (status < 200 || status >= 300)
          return reject(new DetectError('unknown', 'http_error', `${target.address}: HTTP ${status}`));
        try {
          resolve({ body: JSON.parse(text) as unknown, fingerprint });
        } catch {
          reject(new DetectError('unknown', 'bad_answer', `${target.address}: not JSON`));
        }
      });
    });
    request.on('timeout', () =>
      request.destroy(new DetectError('unreachable', 'timeout', `${target.address}: no answer`)),
    );
    request.on('error', (error: Error & { code?: string }) =>
      reject(error instanceof DetectError ? error : networkError(error, target)),
    );
  });
}
