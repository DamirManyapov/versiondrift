// VD_DEMO=1 (docs/specs/fleet-ui.md §10): an instance without hosts starts with the design's demo fleet.
import { seedFleetDemo, type FleetDemo } from '@versiondrift/db';
import { env } from '$env/dynamic/private';
import { selfHostedStorage } from './storage';

export async function seedDemoFleet(): Promise<void> {
  if (env.VD_DEMO !== '1') return;
  const { default: demo } = (await import('../../../../../fixtures/fleet-demo.json')) as {
    default: FleetDemo;
  };
  if (seedFleetDemo(selfHostedStorage(), demo)) console.log('VD_DEMO=1: seeded the demo fleet (31 hosts)');
}
