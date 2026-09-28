export { detect } from './detect.ts';
export { generateSshKey, type SshKeyPair } from './keys.ts';
export { parseLinuxInventory } from './parse/linux.ts';
export { parseProxmoxVersion, parseRouterOs, parseWindowsVer } from './parse/others.ts';
export { upstreamVersion } from './parse/version.ts';
export { DetectError, httpsJson, sshExec, sshFingerprint } from './transport.ts';
export type { Credentials, Detection, Found, HostKind, Pins, Target } from './types.ts';
