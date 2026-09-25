import { authMode } from '$lib/server/auth';
import { mode } from '$lib/server/storage';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
  locale: locals.locale,
  theme: locals.theme,
  mode: mode(),
  account:
    mode() === 'selfhosted' && locals.user
      ? { name: locals.user.name, role: locals.user.role, auth: authMode() }
      : null,
});
