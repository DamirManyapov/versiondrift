import type { FeedProduct } from '@versiondrift/schema';
import { describe, expect, it } from 'vitest';
import { relevanceOf } from '../src/lib/board/relevance.ts';
import { isoWeek, mondayOf, shiftWeek, weekId } from '../src/lib/week.ts';

describe('iso weeks', () => {
  it('computes ids, Mondays and shifts across year boundaries', () => {
    expect(weekId(isoWeek(new Date('2026-09-26T12:00:00Z')))).toBe('2026-W39');
    expect(mondayOf('2026-W39')?.toISOString().slice(0, 10)).toBe('2026-09-21');
    expect(shiftWeek('2026-W01', -1)).toBe('2025-W52');
    expect(shiftWeek('2026-W53', 1)).toBe('2027-W01');
    expect(mondayOf('nope')).toBeUndefined();
  });
});

describe('relevanceOf', () => {
  const product = {
    versionScheme: 'semver',
    tracks: [
      { id: '13', match: '^13\\.' },
      { id: '12', match: '^12\\.' },
    ],
    defaultTrack: 'latest',
  } as unknown as FeedProduct;

  it('says whether a release is news for the user', () => {
    expect(relevanceOf(product, '12.4.11', true, [{ p: 'g', ver: '12.4.5' }])).toBe('affectsYouSecurity');
    expect(relevanceOf(product, '12.4.11', false, [{ p: 'g', ver: '12.4.5' }])).toBe('affectsYou');
    expect(relevanceOf(product, '12.4.5', false, [{ p: 'g', ver: '12.4.5' }])).toBe('installed');
    expect(relevanceOf(product, '13.2.2', false, [{ p: 'g', ver: '12.4.5' }])).toBe('otherTrack');
    expect(relevanceOf(product, '13.2.2', false, [{ p: 'g', ver: '12.4.5', track: 'latest' }])).toBe(
      'affectsYou',
    );
    expect(relevanceOf(product, '13.2.2', false, [])).toBe('notOnBoard');
  });
});
