import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const source = fileURLToPath(new URL('../../app/dist/', import.meta.url));
const target = resolve(fileURLToPath(new URL('../www/', import.meta.url)));
const staging = `${target}.tmp`;

if (!existsSync(`${source}/index.html`)) {
  throw new Error('Missing app/dist/index.html. Run pnpm --filter @t-box/capacitor build:web first.');
}

try {
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  cpSync(source, staging, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
console.log('Copied app/dist → capacitor/www.');
