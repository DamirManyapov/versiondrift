import type { SecuritySource } from '@versiondrift/schema';
import type { AdapterContext } from '../types.ts';
import { ghsaAdvisories } from './ghsa.ts';
import { nvdAdvisories } from './nvd.ts';
import { osvAdvisories } from './osv.ts';
import type { RawAdvisory } from './types.ts';

/** Advisories from one security source. `debian` (per inventory) and `rss` (announcements) give none yet. */
export function fetchAdvisories(source: SecuritySource, ctx: AdapterContext): Promise<RawAdvisory[]> {
  switch (source.type) {
    case 'ghsa':
      return ghsaAdvisories(source, ctx);
    case 'nvd':
      return nvdAdvisories(source, ctx);
    case 'osv':
      return osvAdvisories(source, ctx);
    case 'debian':
    case 'rss':
      return Promise.resolve([]);
  }
}
