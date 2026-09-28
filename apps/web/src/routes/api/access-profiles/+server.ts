import { error } from '@sveltejs/kit';
import { generateSshKey } from '@versiondrift/detect';
import { attempt, body, json } from '$lib/server/api';
import { selfHostedStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

const KINDS = ['ssh-linux', 'windows', 'routeros', 'proxmox'] as const;

/**
 * A new access profile: `{ name, kind, username, secret? }`. Linux profiles get a key pair made by the instance
 * (the answer carries the public key); the others take a password or a token secret. Secrets are never returned.
 */
export const POST: RequestHandler = async ({ request }) => {
  const input = (await body(request)) as Record<string, unknown>;
  const kind = KINDS.find((k) => k === input.kind);
  if (!kind) error(400, `kind is one of ${KINDS.join(', ')}`);
  const text = (key: string) => (typeof input[key] === 'string' ? input[key] : '');
  const { fleet } = selfHostedStorage();
  const profile = attempt(() =>
    fleet.createProfile({
      name: text('name'),
      kind,
      username: text('username'),
      ...(kind === 'ssh-linux'
        ? { keyPair: generateSshKey() }
        : text('secret') && { secret: text('secret') }),
    }),
  );
  return json(profile, { status: 201 });
};
