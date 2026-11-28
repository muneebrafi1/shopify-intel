/**
 * Cuts the 1200×630 social-preview crop (`<stamp>.og.jpg`) for every desktop capture that lacks
 * one. Idempotent; run `nice node scripts/capture/make-og.ts`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ogCrop } from './process.ts';

const ROOT = join(process.cwd(), '.data/captures/objects/shots');
let made = 0;
for (const domain of readdirSync(ROOT)) {
  const dirs = existsSync(join(ROOT, domain)) ? readdirSync(join(ROOT, domain)) : [];
  for (const page of dirs) {
    const dir = join(ROOT, domain, page, 'desktop');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/^\d{8}T\d{6}Z\.webp$/.test(f)) continue;
      const out = join(dir, f.replace(/\.webp$/, '.og.jpg'));
      if (existsSync(out)) continue;
      writeFileSync(out, await ogCrop(readFileSync(join(dir, f)), 1440));
      made++;
    }
  }
}
console.log(`og crops written: ${made}`);
