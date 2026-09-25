// minisign-compatible signatures (https://jedisct1.github.io/minisign/), "ED" = Ed25519 over BLAKE2b-512 of the file.
// Anyone can verify the feed with the stock tool:  minisign -Vm index.json -P <public key>
// The secret key is kept in our own one-line format (not minisign's encrypted file), for a CI secret.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

const ALG_PREHASHED = Buffer.from('ED');
const ALG_PUBLIC_KEY = Buffer.from('Ed');
const SECRET_PREFIX = 'vdsign1';

export interface SigningKey {
  /** 8 bytes, as stored in minisign keys and signatures. */
  keyId: Buffer;
  privateKey: ReturnType<typeof createPrivateKey>;
}

/** minisign prints key ids as the little-endian uint64 in upper-case hex. */
export const keyIdHex = (keyId: Buffer) => Buffer.from(keyId).reverse().toString('hex').toUpperCase();

export function generateSigningKey(): { secret: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = randomBytes(8);
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const raw = publicKey.export({ format: 'jwk' }).x!;
  return {
    secret: `${SECRET_PREFIX}:${keyId.toString('hex')}:${pkcs8.toString('base64')}`,
    publicKey: publicKeyFile(keyId, Buffer.from(raw, 'base64url')),
  };
}

export function parseSecret(secret: string): SigningKey {
  const [prefix, id, der] = secret.trim().split(':');
  if (prefix !== SECRET_PREFIX || !id || !der) throw new Error('MINISIGN_SECRET_KEY has an unknown format');
  return {
    keyId: Buffer.from(id, 'hex'),
    privateKey: createPrivateKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'pkcs8' }),
  };
}

function publicKeyFile(keyId: Buffer, raw: Buffer): string {
  const line = Buffer.concat([ALG_PUBLIC_KEY, keyId, raw]).toString('base64');
  return `untrusted comment: minisign public key ${keyIdHex(keyId)}\n${line}\n`;
}

export function publicKeyOf(key: SigningKey): string {
  const raw = createPublicKey(key.privateKey).export({ format: 'jwk' }).x!;
  return publicKeyFile(key.keyId, Buffer.from(raw, 'base64url'));
}

const blake2b512 = (data: Buffer | string) => createHash('blake2b512').update(data).digest();

/** Returns the .minisig file contents for `data`. The trusted comment is covered by the signature. */
export function signFile(data: Buffer | string, key: SigningKey, trustedComment: string): string {
  if (/[\r\n]/.test(trustedComment)) throw new Error('trusted comment must be one line');
  const signature = sign(null, blake2b512(data), key.privateKey);
  const global = sign(null, Buffer.concat([signature, Buffer.from(trustedComment)]), key.privateKey);
  const sigLine = Buffer.concat([ALG_PREHASHED, key.keyId, signature]).toString('base64');
  return [
    'untrusted comment: signature from VersionDrift collector',
    sigLine,
    `trusted comment: ${trustedComment}`,
    global.toString('base64'),
    '',
  ].join('\n');
}

/** Verifies a .minisig against a minisign public key (file contents or its base64 line); returns the trusted comment. */
export function verifyFile(data: Buffer | string, minisig: string, publicKey: string): string {
  const keyLine = publicKey.trim().split('\n').pop()!.trim();
  const pk = Buffer.from(keyLine, 'base64');
  if (pk.length !== 42 || !pk.subarray(0, 2).equals(ALG_PUBLIC_KEY))
    throw new Error('not a minisign Ed25519 public key');
  const [, sigLine = '', trustedLine = '', globalLine = ''] = minisig.split('\n');
  const sig = Buffer.from(sigLine.trim(), 'base64');
  if (sig.length !== 74 || !sig.subarray(0, 2).equals(ALG_PREHASHED))
    throw new Error('unsupported signature format');
  if (!sig.subarray(2, 10).equals(pk.subarray(2, 10))) throw new Error('signature made with a different key');
  const publicKeyObject = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: pk.subarray(10).toString('base64url') },
    format: 'jwk',
  });
  const signature = sig.subarray(10);
  if (!verify(null, blake2b512(data), publicKeyObject, signature)) throw new Error('invalid signature');
  if (!trustedLine.startsWith('trusted comment: ')) throw new Error('missing trusted comment');
  const comment = trustedLine.slice('trusted comment: '.length);
  const global = Buffer.from(globalLine.trim(), 'base64');
  if (!verify(null, Buffer.concat([signature, Buffer.from(comment)]), publicKeyObject, global)) {
    throw new Error('invalid trusted comment signature');
  }
  return comment;
}
