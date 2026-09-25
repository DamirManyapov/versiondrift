import { z } from 'zod';
import { FeedIndex, FeedProduct } from './feed.ts';
import { Module } from './module.ts';

const BASE = 'https://versiondrift.dev/schemas/';
export const MODULE_SCHEMA_ID = `${BASE}module.schema.json`;

function build(
  schema: z.ZodType,
  file: string,
  title: string,
  io: 'input' | 'output',
): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(schema, { target: 'draft-2020-12', io });
  return {
    $schema,
    $id: `${BASE}${file}`,
    title,
    description: 'Generated from packages/schema (zod) by `pnpm schema:gen`. Do not edit by hand.',
    ...rest,
  };
}

/** JSON Schema (draft 2020-12) for products/*.yaml, as written by `pnpm schema:gen`. */
export function moduleJsonSchema(): Record<string, unknown> {
  return build(Module, 'module.schema.json', 'VersionDrift product module', 'input');
}

/** Every file `pnpm schema:gen` writes to schemas/, by file name. */
export function generatedSchemas(): Record<string, Record<string, unknown>> {
  return {
    'module.schema.json': moduleJsonSchema(),
    'feed-product.schema.json': build(
      FeedProduct,
      'feed-product.schema.json',
      'VersionDrift feed: product file (v1)',
      'output',
    ),
    'feed-index.schema.json': build(
      FeedIndex,
      'feed-index.schema.json',
      'VersionDrift feed: index.json (v1)',
      'output',
    ),
  };
}
