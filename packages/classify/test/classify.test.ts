import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyNotes, MAX_ITEM_LENGTH, MAX_ITEMS } from '../src/index.ts';

const sample = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
const summary = (items: { type: string; classifiedBy: string; text: string }[]) =>
  items.map((i) => `${i.type}/${i.classifiedBy}: ${i.text}`);

describe('classifyNotes', () => {
  it('maps GitHub release sections and strips PR and author references (Grafana)', () => {
    const { items } = classifyNotes({ format: 'markdown', body: sample('grafana-13.2.1.md') });
    expect(summary(items)).toEqual([
      'security/section: Security: Fix CVE-2026-12704',
      'security/section: Security: Fix CVE-2026-14199',
      'fix/section: Dashboards: Fix adhoc and groupby variable datasource on UI import',
      'fix/section: Packaging: Fix issue with bundled plugins not being moved properly',
      "fix/section: PanelEditor: Fix options pane not resizable beyond the preview's content width",
    ]);
    expect(items[0]?.refs).toEqual(['CVE-2026-12704']);
  });

  it('uses module keywords and default keywords for flat HTML lists (poste.io)', () => {
    const { items } = classifyNotes(
      { format: 'html', body: sample('poste-2.5.17.html') },
      { keywords: { security: ['roundcube', 'dovecot'] } },
    );
    expect(items).toHaveLength(12);
    expect(items[0]).toMatchObject({ type: 'security', classifiedBy: 'keyword', text: 'Roundcube 1.6.19' });
    expect(items.find((i) => i.text.includes('fixed offset'))?.type).toBe('other');
    expect(items.find((i) => i.text.includes('fix renewals'))?.type).toBe('fix');
  });

  it('reads MikroTik "*) item" text and ignores upgrade instructions', () => {
    const { items } = classifyNotes({ format: 'html', body: sample('routeros-7.24.4.html') });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'fix', classifiedBy: 'keyword' });
    expect(items[0]?.text).toContain('EC25-EU&KNe');
  });

  it('keeps a short prose announcement when there are no bullets (Debian)', () => {
    const { items } = classifyNotes({ format: 'html', body: sample('debian-13.7.html') });
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toMatch(/^The Debian project is pleased to announce/);
  });

  it('understands Keep a Changelog sections', () => {
    const md = [
      '## [2.0.0] - 2026-01-02',
      '### Added',
      '- Dark mode',
      '### Removed',
      '- Python 3.8',
      '### Deprecated',
      '- Old API',
      '### Fixed',
      '- Login',
      '### Security',
      '- Escape names',
    ].join('\n');
    expect(summary(classifyNotes({ format: 'markdown', body: md }).items)).toEqual([
      'feature/section: Dark mode',
      'breaking/section: Python 3.8',
      'deprecated/section: Old API',
      'fix/section: Login',
      'security/section: Escape names',
    ]);
  });

  it('handles GitHub auto-generated notes', () => {
    const md = [
      "## What's Changed",
      '* Fix crash on empty config by @alice in https://github.com/o/r/pull/12',
      '* Add YAML export by @bob[bot] in https://github.com/o/r/pull/13',
      '## New Contributors',
      '* @carol made their first contribution in https://github.com/o/r/pull/11',
      '',
      '**Full Changelog**: https://github.com/o/r/compare/v1.0.0...v1.1.0',
    ].join('\n');
    expect(summary(classifyNotes({ format: 'markdown', body: md }).items)).toEqual([
      'fix/keyword: Fix crash on empty config',
      'feature/keyword: Add YAML export',
    ]);
  });

  it('treats a CVE id as security even under "Bug fixes"', () => {
    const md =
      '### Bug fixes\n- Auth: fix token check (CVE-2026-1234, ghsa-abcd-efgh-ijkl)\n- UI: fix layout';
    const { items } = classifyNotes({ format: 'markdown', body: md });
    expect(items[0]).toMatchObject({
      type: 'security',
      classifiedBy: 'keyword',
      refs: ['CVE-2026-1234', 'GHSA-abcd-efgh-ijkl'],
    });
    expect(items[1]).toMatchObject({ type: 'fix', classifiedBy: 'section' });
  });

  it('uses the nearest meaningful heading, bold pseudo-headings and module section hints', () => {
    const md = [
      '## 2.0.0',
      '### Breaking changes',
      '- Config moved',
      '**Bug fixes**',
      '- Leak',
      '### Hardening',
      '- TLS 1.3 only',
    ].join('\n');
    const { items } = classifyNotes(
      { format: 'markdown', body: md },
      { sections: { security: ['Hardening'] } },
    );
    expect(summary(items)).toEqual([
      'breaking/section: Config moved',
      'fix/section: Leak',
      'security/section: TLS 1.3 only',
    ]);
  });

  it('reads plain text with list lines and "Heading:" lines', () => {
    const text = 'Changes:\n- faster start\n- fixed the login bug\nSome closing words.';
    expect(summary(classifyNotes({ format: 'text', body: text }).items)).toEqual([
      'other/section: faster start',
      'fix/keyword: fixed the login bug',
    ]);
  });

  it('labels unmatched items as default, trims long items and dedupes', () => {
    const long = `- ${'word '.repeat(100)}`;
    const { items } = classifyNotes({
      format: 'markdown',
      body: `- Something happened\n- Something happened\n${long}`,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: 'other', classifiedBy: 'default' });
    expect(items[1]!.text.length).toBeLessThanOrEqual(MAX_ITEM_LENGTH);
    expect(items[1]!.text.endsWith('…')).toBe(true);
  });

  it(`keeps at most ${MAX_ITEMS} items, dropping the least important and keeping order`, () => {
    const bullets = [
      ...Array.from({ length: 45 }, (_, i) => `- Tweak ${i}`),
      '- Fix CVE-2026-0001',
      '- Removed old flag',
    ];
    const { items, omitted } = classifyNotes({ format: 'markdown', body: bullets.join('\n') });
    expect(items).toHaveLength(MAX_ITEMS);
    expect(omitted).toBe(7);
    expect(items.slice(-2).map((i) => i.type)).toEqual(['security', 'breaking']);
    expect(items[0]?.text).toBe('Tweak 0');
  });

  it('returns nothing for missing or empty notes', () => {
    expect(classifyNotes(undefined)).toEqual({ items: [], omitted: 0 });
    expect(classifyNotes({ format: 'markdown', body: '  ' })).toEqual({ items: [], omitted: 0 });
  });
});
