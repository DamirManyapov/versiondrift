import { z } from 'zod';
import { Module } from './module.ts';

export const MODULE_SCHEMA_ID = 'https://versiondrift.dev/schemas/module.schema.json';

/** JSON Schema (draft 2020-12) for products/*.yaml, as written by `pnpm schema:gen`. */
export function moduleJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(Module, { target: 'draft-2020-12', io: 'input' });
  return {
    $schema,
    $id: MODULE_SCHEMA_ID,
    title: 'VersionDrift product module',
    description: 'Generated from packages/schema (zod) by `pnpm schema:gen`. Do not edit by hand.',
    ...rest,
  };
}
