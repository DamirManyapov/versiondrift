import { describe, expect, it } from 'vitest';
import { searchCatalog } from '../src/lib/catalog.ts';

const products = [
  { id: 'postgresql', name: 'PostgreSQL', category: 'database', aliases: ['postgres', 'pg'] },
  {
    id: 'proxmox-ve',
    name: 'Proxmox VE',
    category: 'virtualization',
    vendor: 'Proxmox Server Solutions',
    aliases: ['pve'],
  },
  {
    id: 'grafana',
    name: 'Grafana',
    category: 'monitoring',
    description: 'Dashboards, visualization and alerting.',
  },
];

describe('searchCatalog', () => {
  it('matches every word against name, id, vendor, aliases and description', () => {
    expect(searchCatalog(products, 'pg').map((p) => p.id)).toEqual(['postgresql']);
    expect(searchCatalog(products, 'proxmox solutions').map((p) => p.id)).toEqual(['proxmox-ve']);
    expect(searchCatalog(products, 'alerting').map((p) => p.id)).toEqual(['grafana']);
    expect(searchCatalog(products, '').length).toBe(3);
    expect(searchCatalog(products, '', 'database').map((p) => p.id)).toEqual(['postgresql']);
  });
});
