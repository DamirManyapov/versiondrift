// SSH keys the instance makes for Linux access profiles (ADR-0007): ed25519, the private key in OpenSSH's own
// format ("openssh-key-v1", unencrypted: it is sealed in the database) because that is what SSH clients read, the
// public key as an authorized_keys line.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const field = (b: Buffer | string) => {
  const data = typeof b === 'string' ? Buffer.from(b) : b;
  return Buffer.concat([u32(data.length), data]);
};

export interface SshKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateSshKey(comment = 'versiondrift'): SshKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d!, 'base64url');
  const pubBlob = Buffer.concat([field('ssh-ed25519'), field(pub)]);
  const check = randomBytes(4);
  let secret = Buffer.concat([
    check,
    check,
    field('ssh-ed25519'),
    field(pub),
    field(Buffer.concat([seed, pub])),
    field(comment),
  ]);
  const pad = (8 - (secret.length % 8)) % 8;
  secret = Buffer.concat([secret, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
  const body = Buffer.concat([
    Buffer.from('openssh-key-v1\0'),
    field('none'),
    field('none'),
    field(''),
    u32(1),
    field(pubBlob),
    field(secret),
  ]);
  const lines = body.toString('base64').match(/.{1,70}/g) ?? [];
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: `ssh-ed25519 ${pubBlob.toString('base64')} ${comment}`,
  };
}
