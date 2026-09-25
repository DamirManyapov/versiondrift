// Signing lives in @versiondrift/feed, next to the verification self-hosted instances and notify use.
export {
  generateSigningKey,
  keyIdHex,
  parseSecret,
  publicKeyOf,
  signFile,
  verifyFile,
  type SigningKey,
} from '@versiondrift/feed';
