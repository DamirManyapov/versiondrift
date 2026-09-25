// pnpm schema:gen — writes schemas/module.schema.json from the zod schema.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { moduleJsonSchema } from '../json-schema.ts';
import { MODULE_SCHEMA_FILE, REPO_ROOT, serializeJsonSchema } from './paths.ts';

await writeFile(MODULE_SCHEMA_FILE, serializeJsonSchema(moduleJsonSchema()));
console.log(`wrote ${path.relative(REPO_ROOT, MODULE_SCHEMA_FILE)}`);
