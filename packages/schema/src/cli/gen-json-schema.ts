// pnpm schema:gen — writes schemas/*.json from the zod schemas.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generatedSchemas } from '../json-schema.ts';
import { REPO_ROOT, SCHEMAS_DIR, serializeJsonSchema } from './paths.ts';

for (const [file, schema] of Object.entries(generatedSchemas())) {
  const target = path.join(SCHEMAS_DIR, file);
  await writeFile(target, serializeJsonSchema(schema));
  console.log(`wrote ${path.relative(REPO_ROOT, target)}`);
}
