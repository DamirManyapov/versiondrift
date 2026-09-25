import type { ParamMatcher } from '@sveltejs/kit';

/** Compare pages: /p/<id>/<from>...<to> (docs/06). */
export const match: ParamMatcher = (param) => param.includes('...');
