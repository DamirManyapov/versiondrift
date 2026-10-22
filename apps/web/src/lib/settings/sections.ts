// The sections of Settings (docs/06): the left menu of /settings and the user menu link to the same pages. A public
// site has the general section only; notifications are for admins; without sign-in (VD_AUTH=none) there is no account.
import type { MessageKey } from '$lib/i18n';

export const SETTINGS_SECTIONS = [
  { path: '/settings', key: 'settingsGeneral' },
  { path: '/settings/sites', key: 'sitesTitle' },
  { path: '/settings/notifications', key: 'notificationsTitle' },
  { path: '/settings/feed', key: 'feedTitle' },
  { path: '/settings/account', key: 'accountTitle' },
] as const satisfies readonly { path: string; key: MessageKey }[];

export type SettingsPath = (typeof SETTINGS_SECTIONS)[number]['path'];

export function settingsSections(
  mode: 'public' | 'selfhosted',
  account: { role: 'admin' | 'viewer'; auth: string } | null | undefined,
  sites: boolean,
): { path: SettingsPath; key: MessageKey }[] {
  if (mode !== 'selfhosted') return [];
  return SETTINGS_SECTIONS.filter(
    (s) =>
      (s.path !== '/settings/notifications' || account?.role === 'admin') &&
      (s.path !== '/settings/account' || (account && account.auth !== 'none')),
  ).map((s) =>
    // A site is a board: "Boards" until there are hosts (BoardsManager says the same).
    s.path === '/settings/sites' && !sites ? { ...s, key: 'boardsTitle' } : s,
  );
}
