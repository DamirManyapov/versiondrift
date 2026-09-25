// inventory.yaml (docs/07-self-hosted.md): what a user runs. Private — never part of the feed.
//   boards:
//     prod:
//       products:
//         grafana: [{ version: "12.4.5", host: mon-01 }, { version: "13.2.1", host: mon-02 }]
//         poste-io: "2.5.17"                  # shorthand: one instance
import { z } from 'zod';

const quoted = z.string({
  error: (issue) =>
    issue.input === undefined ? undefined : 'must be a string: quote versions in YAML, e.g. "12.10"',
});

export const InstanceSpec = z.strictObject({
  version: quoted.min(1),
  /** Pin a track instead of inferring it from the version. */
  track: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
});
export type InstanceSpec = z.output<typeof InstanceSpec>;

export const Inventory = z.strictObject({
  boards: z.record(
    z.string().min(1),
    z.strictObject({
      products: z.record(
        z.string().min(1),
        z.union([quoted.min(1), InstanceSpec, z.array(InstanceSpec).min(1)], {
          error: (issue) =>
            issue.code === 'invalid_union'
              ? 'expected a version string (quote versions in YAML, e.g. "12.10"), { version: "…" } or a list of them'
              : undefined,
        }),
      ),
    }),
  ),
});
export type Inventory = z.output<typeof Inventory>;

export interface InventoryEntry {
  board: string;
  productId: string;
  instances: InstanceSpec[];
}

/** Flattens an inventory into one entry per (board, product), shorthand expanded. */
export function inventoryEntries(inventory: Inventory): InventoryEntry[] {
  return Object.entries(inventory.boards).flatMap(([board, { products }]) =>
    Object.entries(products).map(([productId, spec]) => ({
      board,
      productId,
      instances: typeof spec === 'string' ? [{ version: spec }] : Array.isArray(spec) ? spec : [spec],
    })),
  );
}
