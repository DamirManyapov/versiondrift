import { describe, expect, it } from 'vitest';
import { trackOf } from '../src/index.ts';

const grafana = {
  tracks: [
    { id: '12', match: '^12\\.' },
    { id: '11', match: '^11\\.' },
    { id: 'any-11', match: '^11' },
  ],
};

describe('trackOf', () => {
  it('returns the first matching track, after stripping "v"', () => {
    expect(trackOf(grafana, '12.1.2')).toBe('12');
    expect(trackOf(grafana, 'v11.6.0')).toBe('11');
  });

  it('returns null when nothing matches or there are no tracks', () => {
    expect(trackOf(grafana, '10.4.0')).toBeNull();
    expect(trackOf({}, '1.0.0')).toBeNull();
  });
});
