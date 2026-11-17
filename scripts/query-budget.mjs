#!/usr/bin/env node
/**
 * D1 query budget per request. The Workers free plan allows 50 D1 queries per invocation; in
 * `astro dev` every response carries `x-d1-queries: <calls>/<statements>` (src/middleware.ts,
 * src/server/db/d1.ts). This crawls a representative route list against a running dev server and
 * fails when any page runs more than BUDGET statements (default 45, headroom under 50).
 *
 *   npx astro dev status            # the dev server must be running (and otherwise idle:
 *   npm run budget:queries          # the meter is per process, so parallel requests skew it)
 *
 * Env: BUDGET_BASE_URL (default http://127.0.0.1:4321), BUDGET_MAX (default 45). Extra routes
 * can be passed as arguments: `npm run budget:queries -- /apps?view=grid&p=3`.
 */
const BASE = (process.env.BUDGET_BASE_URL ?? 'http://127.0.0.1:4321').replace(/\/$/, '');
const MAX = Number(process.env.BUDGET_MAX ?? 45);

// The heaviest page of each kind: list grids that show something per row, details, compares.
const ROUTES = [
  '/',
  '/apps',
  '/apps?view=grid',
  '/apps?view=grid&p=2',
  '/apps/categories/reviews',
  '/apps/categories/upsell-and-bundles',
  '/apps/judgeme',
  '/compare/judgeme-vs-loox',
  '/compare/dawn-vs-horizon',
  '/alternatives/klaviyo',
  '/stores',
  '/stores/youngla.com',
  '/themes',
  '/themes/prestige',
  '/sections',
  '/sections/reviews',
  '/teardowns/youngla',
  ...process.argv.slice(2),
];

let failed = false;
const rows = [];
for (const route of ROUTES) {
  let res;
  try {
    res = await fetch(`${BASE}${route}`, { redirect: 'manual' });
    await res.arrayBuffer();
  } catch (err) {
    console.error(`Cannot reach ${BASE}${route}: ${err.message}`);
    console.error('Start the dev server first (npm run dev; npx astro dev status).');
    process.exit(2);
  }
  const header = res.headers.get('x-d1-queries');
  if (!header) {
    console.error(`${route}: no x-d1-queries header (status ${res.status}).`);
    console.error('The meter only runs in `astro dev`; point BUDGET_BASE_URL at a dev server.');
    process.exit(2);
  }
  const [calls, statements] = header.split('/').map(Number);
  const ok = res.status < 400 && statements <= MAX;
  failed ||= !ok;
  rows.push({ ok, route, status: res.status, calls, statements });
}

console.log('      stmts calls  status  route');
for (const r of rows) {
  console.log(
    `${r.ok ? 'ok  ' : 'FAIL'} ${String(r.statements).padStart(4)} ${String(r.calls).padStart(4)}  ${r.status}  ${r.route}`,
  );
}
const worst = rows.reduce((m, r) => Math.max(m, r.statements), 0);
console.log(
  `\n${rows.length} routes, most D1 statements in one request: ${worst} (budget ${MAX}, D1 free plan 50).`,
);
process.exit(failed ? 1 : 0);
