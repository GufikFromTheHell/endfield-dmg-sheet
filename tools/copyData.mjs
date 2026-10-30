// tools/copyData.mjs — copies data/*.json into dist/data after `vite build`.
// The bundles are committed in-repo and shipped as-is (static hosting, no
// build-time fetch). Run: node tools/copyData.mjs
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(ROOT, 'data');
const dst = join(ROOT, 'dist', 'data');
if (!existsSync(src)) {
  console.error('data/ missing — run `npm run normalize` first');
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`copied data/ -> dist/data/`);