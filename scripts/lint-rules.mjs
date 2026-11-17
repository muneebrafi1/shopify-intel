#!/usr/bin/env node
/**
 * Project rules that generic linters don't know about (see CLAUDE.md):
 *  1. The brand name only lives in src/config/site.ts (SITE_NAME).
 *  2. Affiliate URLs live in data, never in components or pages.
 *  3. No secrets, tokens or personal emails in source.
 * Exits non-zero with file:line for every violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN_DIRS = ['src', 'scripts', 'tests', 'migrations', 'docs', '.github'];
const EXTS = /\.(astro|ts|mjs|js|sql|md|yml|yaml|json|css)$/;
const siteConfig = readFileSync(join(ROOT, 'src/config/site.ts'), 'utf8');
const brand = /SITE_NAME = '([^']+)'/.exec(siteConfig)?.[1];

const rules = [
  {
    id: 'brand-name',
    test: (rel, line) =>
      brand &&
      rel.startsWith('src/') &&
      rel !== 'src/config/site.ts' &&
      new RegExp(`\\b${brand}\\b`).test(line),
    message: `Brand name "${brand}" is hard-coded; import SITE_NAME from ~/config/site`,
  },
  {
    id: 'affiliate-url',
    test: (rel, line) =>
      rel.startsWith('src/') &&
      /(shoffi\.app\/r\/|partner\.gorgias|utm_medium=affiliate|[?&]fpr=|partnerstack\.com\/|\?ref=|\?via=)/i.test(
        line,
      ),
    message: 'Affiliate URL in source; keep affiliate links in data (served via /go/:id)',
  },
  {
    id: 'secret',
    test: (_rel, line) =>
      /(AKIA[0-9A-Z]{16}|sk_(live|test)_[0-9a-zA-Z]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[0-9A-Za-z]{30,}|xox[baprs]-[0-9A-Za-z-]{10,})/.test(
        line,
      ),
    message: 'Looks like a secret; use environment variables / Wrangler secrets',
  },
  {
    id: 'personal-email',
    test: (_rel, line) =>
      /[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|icloud|proton)\.(com|me)\b/i.test(line) &&
      !/example|placeholder|someone@/i.test(line),
    message: 'Personal email address in source',
  },
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.wrangler') || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXTS.test(name)) files.push(p);
  }
};
for (const d of SCAN_DIRS) {
  try {
    walk(join(ROOT, d));
  } catch {
    /* directory may not exist yet */
  }
}

const problems = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  if (rel === 'scripts/lint-rules.mjs') continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const rule of rules)
        if (rule.test(rel, line)) problems.push(`${rel}:${i + 1}  [${rule.id}] ${rule.message}`);
    });
}
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`lint-rules: ${files.length} files clean.`);
