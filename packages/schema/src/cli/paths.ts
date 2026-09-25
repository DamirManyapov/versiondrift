import path from 'node:path';

/** Repository root, resolved from this file so scripts work from any cwd. */
export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
export const PRODUCTS_DIR = path.join(REPO_ROOT, 'products');
export const SCHEMAS_DIR = path.join(REPO_ROOT, 'schemas');
export const MODULE_SCHEMA_FILE = path.join(SCHEMAS_DIR, 'module.schema.json');

/** The exact bytes `pnpm schema:gen` writes. */
export function serializeJsonSchema(schema: unknown): string {
  return JSON.stringify(schema, null, 2) + '\n';
}
