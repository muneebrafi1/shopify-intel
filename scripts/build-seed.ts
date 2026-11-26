/// <reference types="node" />
/**
 * npm run db:build-seed
 * Builds .data/seed.sql from data/seed/*.json and data/curation/* (deterministic).
 * Prints a summary and any data warnings (count mismatches, unresolved links, …).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedFromRoot } from './seed/build.ts';
import { writeLedger } from './seed/ids.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.data/seed.sql');

const { sql, report, ledger } = buildSeedFromRoot(root);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sql);
writeLedger(root, ledger);

const heights = (device: string) =>
  report.shotHeights.filter((h) => h.device === device).map((h) => h.height);
const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)} px` : 'n/a');

console.log(
  `Wrote ${out} (${(sql.length / 1024).toFixed(0)} KB), data_version=${report.dataVersion}`,
);
console.log(
  Object.entries(report.counts)
    .map(([table, n]) => `  ${table.padEnd(24)} ${n}`)
    .join('\n'),
);
console.log(
  `  placeholder heights: desktop ${range(heights('desktop'))}, mobile ${range(heights('mobile'))}`,
);
if (report.warnings.length) {
  console.log(`\n${report.warnings.length} warning(s):`);
  for (const w of report.warnings) console.log(`  - ${w}`);
}
