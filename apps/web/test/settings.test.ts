import { describe, expect, it } from 'vitest';
import { settingsSections } from '../src/lib/settings/sections.ts';

const paths = (...args: Parameters<typeof settingsSections>) => settingsSections(...args).map((s) => s.path);

describe('settingsSections', () => {
  it('has no sections on the public site', () => {
    expect(settingsSections('public', null, false)).toEqual([]);
  });

  it('gives an admin every section, "Sites" once there are hosts', () => {
    const admin = { role: 'admin' as const, auth: 'password' };
    expect(paths('selfhosted', admin, true)).toEqual([
      '/settings',
      '/settings/sites',
      '/settings/notifications',
      '/settings/feed',
      '/settings/account',
    ]);
    expect(settingsSections('selfhosted', admin, true)[1]!.key).toBe('sitesTitle');
    expect(settingsSections('selfhosted', admin, false)[1]!.key).toBe('boardsTitle');
  });

  it('hides notifications from viewers and the account without sign-in', () => {
    expect(paths('selfhosted', { role: 'viewer', auth: 'oidc' }, false)).not.toContain(
      '/settings/notifications',
    );
    expect(paths('selfhosted', { role: 'admin', auth: 'none' }, false)).not.toContain('/settings/account');
  });
});
