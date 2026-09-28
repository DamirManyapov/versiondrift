// What a detector reports (ADR-0007): the products it found on a host, or why it could not read them.

export type HostKind = 'ssh-linux' | 'windows' | 'routeros' | 'proxmox';

export interface Target {
  name: string;
  address: string;
  port: number | null;
  kind: HostKind;
}

export interface Credentials {
  username: string;
  secret: string | null;
  privateKey: string | null;
}

export interface Found {
  productId: string;
  version: string | null;
  /** Track (line) when the host says which one it follows (a RouterOS update channel). */
  track?: string;
  label?: string;
  /** What was read, kept when the version could not be recognized. */
  readRaw?: string;
}

/** Trust on first use: the SSH host key or the TLS certificate seen on the first successful contact. */
export interface Pins {
  hostKey?: string | null;
  tlsFingerprint?: string | null;
}

export type Detection =
  | { ok: true; found: Found[]; pins?: Pins }
  | {
      ok: false;
      state: 'unreachable' | 'auth-failed' | 'unknown';
      /** timeout, refused, auth_denied, host_key_mismatch, tls_mismatch, unrecognized_version, … */
      code: string;
      message: string;
    };
