/**
 * Comparisons and alternatives.
 *
 * Owner decision (draft): /compare pages exist only for the curated popular pairs in the
 * `comparisons` table (top apps per category, top themes, same-vendor themes; built by the seed
 * and the future ingest), so the site never renders thin long-tail pair pages. Any other pair,
 * even of two valid apps or themes, is a 404 (`not_curated`). Alternatives still list every
 * alternative but say whether a comparison page exists (`compare_available`).
 */
import { SOURCE_IDS, type Ctx } from '../api/v1/context.ts';
import { ApiError, notFound } from '../api/v1/errors.ts';
import { hrefs } from '../api/v1/hrefs.ts';
import type { AppDetail, AppListItem } from '../api/v1/schemas/apps.ts';
import type {
  Alternatives,
  ComparisonDetail,
  ListAlternativesOutput,
  MatrixRow,
} from '../api/v1/schemas/compare.ts';
import type { ThemeDetail } from '../api/v1/schemas/themes.ts';
import { alternativeApps, findApp, getAppDetail, hydrateApps } from './apps.ts';
import { comparisonLinks, comparisonTitle } from './comparisons.ts';
import { APP_REF_COLS, appRef, jsonIds } from './refs.ts';
import { storeRefsByIds } from './stores.ts';
import { findTheme, getThemeDetail, hydrateThemes, similarThemes } from './themes.ts';

/** Canonical pair slug: alphabetical order. */
export const canonicalPair = (a: string, b: string) => (a < b ? `${a}-vs-${b}` : `${b}-vs-${a}`);

/** Canonical slugs among `slugs` that are curated comparisons of `kind` (one query). */
export async function curatedPairs(
  ctx: Ctx,
  kind: 'app' | 'theme',
  slugs: readonly string[],
): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await ctx.db.all<{ slug: string }>(
    'SELECT slug FROM comparisons WHERE kind = ? AND slug IN (SELECT value FROM json_each(?))',
    [kind, jsonIds(slugs)],
  );
  return new Set(rows.map((r) => r.slug));
}

/** True when the canonical pair has a /compare page (it is a curated popular pair). */
export async function isCuratedComparison(
  ctx: Ctx,
  kind: 'app' | 'theme',
  canonicalSlug: string,
): Promise<boolean> {
  return (await curatedPairs(ctx, kind, [canonicalSlug])).has(canonicalSlug);
}

type Resolved = { kind: 'app'; a: string; b: string } | { kind: 'theme'; a: string; b: string };

/** Tries every '-vs-' split point (slugs may contain hyphens) and resolves both sides. */
async function resolvePair(ctx: Ctx, pair: string): Promise<Resolved> {
  const parts = pair.split('-vs-');
  let mixed = false;
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join('-vs-');
    const right = parts.slice(i).join('-vs-');
    const [appA, appB, themeA, themeB] = await Promise.all([
      findApp(ctx, left),
      findApp(ctx, right),
      findTheme(ctx, left),
      findTheme(ctx, right),
    ]);
    if (appA && appB) {
      if (appA.id === appB.id) throw new ApiError('bad_request', 'Pick two different apps');
      return { kind: 'app', a: appA.app_slug, b: appB.app_slug };
    }
    if (themeA && themeB) {
      if (themeA.id === themeB.id) throw new ApiError('bad_request', 'Pick two different themes');
      return { kind: 'theme', a: themeA.slug, b: themeB.slug };
    }
    if ((appA && themeB) || (themeA && appB)) mixed = true;
  }
  if (mixed) throw new ApiError('bad_request', 'Compare two apps or two themes, not one of each');
  throw notFound(`Comparison '${pair}'`);
}

// ---------------------------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------------------------
type Cell = string | number | boolean | null;
const fmtInt = (n: number) => n.toLocaleString('en-US');
const fmtPct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString('en-US')}%`;
const display = (v: Cell, fmt?: (x: number) => string): string => {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return fmt ? fmt(v) : fmtInt(v);
  return v;
};

function row(
  key: string,
  label: string,
  a: Cell,
  b: Cell,
  source: string,
  opts: {
    better?: 'higher' | 'lower';
    fmt?: (x: number) => string;
    aDisplay?: string;
    bDisplay?: string;
  } = {},
): MatrixRow {
  let winner: MatrixRow['winner'] = null;
  if (opts.better && typeof a === 'number' && typeof b === 'number') {
    winner = a === b ? 'tie' : (opts.better === 'higher') === a > b ? 'a' : 'b';
  }
  return {
    key,
    label,
    a,
    b,
    a_display: opts.aDisplay ?? display(a, opts.fmt),
    b_display: opts.bDisplay ?? display(b, opts.fmt),
    better: opts.better ?? null,
    winner,
    source,
  };
}

function appMatrix(ctx: Ctx, a: AppDetail, b: AppDetail): MatrixRow[] {
  const store = SOURCE_IDS.appStore;
  const scan = ctx.data.scanSourceId;
  const x = a.app;
  const y = b.app;
  return [
    row('category', 'Category', x.category?.name ?? null, y.category?.name ?? null, store),
    row('developer', 'Developer', x.developer, y.developer, store),
    row('rating', 'Rating', x.rating, y.rating, store, {
      better: 'higher',
      fmt: (n: number) => n.toFixed(1),
    }),
    row('reviews', 'Reviews', x.reviews, y.reviews, store, { better: 'higher' }),
    row('free_plan', 'Free plan', x.pricing.free_plan, y.pricing.free_plan, store),
    row('from_price', 'Paid plans from', x.pricing.from_cents, y.pricing.from_cents, store, {
      better: 'lower',
      fmt: (c: number) => (c === 0 ? 'Free' : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}/mo`),
    }),
    row('trial_days', 'Free trial', x.pricing.trial_days, y.pricing.trial_days, store, {
      fmt: (d: number) => `${d} days`,
    }),
    row('built_for_shopify', 'Built for Shopify', x.built_for_shopify, y.built_for_shopify, store),
    row('launched_on', 'Launched', x.launched_on, y.launched_on, store),
    row('languages', 'Languages', x.languages.length || null, y.languages.length || null, store),
    row('stores', 'Detected on stores', x.usage.stores, y.usage.stores, scan, { better: 'higher' }),
    row('share', 'Share of scanned stores', x.usage.share, y.usage.share, scan, {
      better: 'higher',
      fmt: fmtPct,
    }),
    row(
      'sections',
      'Sections in the library',
      a.seen_on.section_total,
      b.seen_on.section_total,
      SOURCE_IDS.capturePlan,
    ),
  ];
}

function themeMatrix(ctx: Ctx, a: ThemeDetail, b: ThemeDetail): MatrixRow[] {
  const scan = ctx.data.scanSourceId;
  const ed = SOURCE_IDS.editorial;
  const x = a.theme;
  const y = b.theme;
  return [
    row('vendor', 'Vendor', x.vendor, y.vendor, ed),
    row('price', 'Price', x.price.cents, y.price.cents, ed, {
      better: 'lower',
      aDisplay: x.price.label ?? '—',
      bDisplay: y.price.label ?? '—',
    }),
    row('marketplace', 'Sold on', x.marketplace, y.marketplace, ed),
    row('stores', 'Detected on stores', x.usage.stores, y.usage.stores, scan, { better: 'higher' }),
    row('share', 'Share of scanned stores', x.usage.share, y.usage.share, scan, {
      better: 'higher',
      fmt: fmtPct,
    }),
    row('versions', 'Versions seen', a.versions.length, b.versions.length, scan),
    row('curated', 'Curated example stores', x.curated_store_count, y.curated_store_count, scan),
    row(
      'sections',
      'Sections in the library',
      a.sections.total,
      b.sections.total,
      SOURCE_IDS.capturePlan,
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Comparison detail
// ---------------------------------------------------------------------------------------------
export async function getComparison(ctx: Ctx, pair: string): Promise<ComparisonDetail> {
  const resolved = await resolvePair(ctx, pair);
  const canonical = canonicalPair(resolved.a, resolved.b);
  if (!(await isCuratedComparison(ctx, resolved.kind, canonical))) {
    throw new ApiError(
      'not_found',
      `No comparison page for '${canonical}': only curated popular pairs have one`,
      { details: [{ path: 'pair', message: 'not_curated' }] },
    );
  }
  const [first, second] =
    resolved.a < resolved.b ? [resolved.a, resolved.b] : [resolved.b, resolved.a];
  const base = {
    kind: resolved.kind,
    slug: pair,
    canonical_slug: canonical,
    is_canonical: pair === canonical,
    href: hrefs.compare(canonical),
  };
  const opts = { storesLimit: 12, sectionsLimit: 8 };

  if (resolved.kind === 'app') {
    const [a, b] = await Promise.all([
      getAppDetail(ctx, first, opts),
      getAppDetail(ctx, second, opts),
    ]);
    const shared = await ctx.db.all<{ store_id: number }>(
      `SELECT x.store_id FROM store_apps x
       JOIN store_apps y ON y.store_id = x.store_id AND y.removed_at IS NULL
       JOIN stores s ON s.id = x.store_id AND s.status = 'active'
       WHERE x.app_id = (SELECT id FROM apps WHERE slug = ?) AND y.app_id = (SELECT id FROM apps WHERE slug = ?)
         AND x.removed_at IS NULL
       ORDER BY s.list_position`,
      [first, second],
    );
    const related = await relatedLinks(ctx, 'app', [a.app.slug, b.app.slug], canonical);
    return {
      ...base,
      title: comparisonTitle(a.app.short_name, b.app.short_name),
      apps: { a, b },
      themes: null,
      shared_stores: {
        total: shared.length,
        items: await storeRefsByIds(
          ctx,
          shared.slice(0, 12).map((s) => s.store_id),
        ),
      },
      shared_apps: [],
      matrix: appMatrix(ctx, a, b),
      related,
    };
  }

  const [a, b] = await Promise.all([
    getThemeDetail(ctx, first, opts),
    getThemeDetail(ctx, second, opts),
  ]);
  const [shared, sharedApps] = await Promise.all([
    // Stores that ran both themes at some point (detection history).
    ctx.db.all<{ store_id: number }>(
      `SELECT DISTINCT x.store_id FROM store_themes x
       JOIN store_themes y ON y.store_id = x.store_id
       JOIN stores s ON s.id = x.store_id AND s.status = 'active'
       WHERE x.theme_id = (SELECT id FROM themes WHERE slug = ?) AND y.theme_id = (SELECT id FROM themes WHERE slug = ?)`,
      [first, second],
    ),
    ctx.db.all<Parameters<typeof appRef>[0] & { a_stores: number; b_stores: number }>(
      `SELECT ua.store_count AS a_stores, ub.store_count AS b_stores, ${APP_REF_COLS}
       FROM theme_app_usage ua
       JOIN theme_app_usage ub ON ub.app_id = ua.app_id
       JOIN apps a ON a.id = ua.app_id AND a.status = 'active'
       LEFT JOIN app_categories ac ON ac.id = a.category_id
       WHERE ua.theme_id = (SELECT id FROM themes WHERE slug = ?) AND ub.theme_id = (SELECT id FROM themes WHERE slug = ?)
       ORDER BY MIN(ua.store_count, ub.store_count) DESC, a.slug LIMIT 10`,
      [first, second],
    ),
  ]);
  return {
    ...base,
    title: comparisonTitle(a.theme.name, b.theme.name),
    apps: null,
    themes: { a, b },
    shared_stores: {
      total: shared.length,
      items: await storeRefsByIds(
        ctx,
        shared.slice(0, 12).map((s) => s.store_id),
      ),
    },
    shared_apps: sharedApps.map((r) => ({
      app: appRef(r),
      a_stores: r.a_stores,
      b_stores: r.b_stores,
    })),
    matrix: themeMatrix(ctx, a, b),
    related: await relatedLinks(ctx, 'theme', [a.theme.slug, b.theme.slug], canonical),
  };
}

async function relatedLinks(ctx: Ctx, kind: 'app' | 'theme', slugs: string[], exclude: string) {
  const links = await comparisonLinks(ctx, { kind, limit: 500 });
  return links
    .filter((l) => l.slug !== exclude && slugs.some((s) => l.a.slug === s || l.b.slug === s))
    .slice(0, 8);
}

// ---------------------------------------------------------------------------------------------
// Alternatives
// ---------------------------------------------------------------------------------------------
export async function getAlternatives(
  ctx: Ctx,
  slug: string,
  kind?: 'app' | 'theme',
): Promise<Alternatives> {
  const app = kind === 'theme' ? null : await findApp(ctx, slug);
  if (app) {
    const [[item], alts, links] = await Promise.all([
      hydrateApps(ctx, [app]),
      alternativeApps(ctx, app, 12),
      comparisonLinks(ctx, { kind: 'app', entityId: app.id, limit: 12 }),
    ]);
    const [shared, curated] = await Promise.all([
      coInstallCounts(ctx, app.id, alts),
      curatedPairs(
        ctx,
        'app',
        alts.map((alt) => canonicalPair(app.app_slug, alt.slug)),
      ),
    ]);
    return {
      kind: 'app',
      slug: app.app_slug,
      title: `${app.app_short_name ?? app.app_name} alternatives`,
      app: item ?? null,
      theme: null,
      category: item?.category ?? null,
      items: alts.map((alt) => ({
        app: alt,
        theme: null,
        shared_stores: shared.get(alt.slug) ?? 0,
        compare_href: hrefs.compare(canonicalPair(app.app_slug, alt.slug)),
        compare_available: curated.has(canonicalPair(app.app_slug, alt.slug)),
        reasons: ['same-category'],
      })),
      comparisons: links,
    };
  }
  const theme = kind === 'app' ? null : await findTheme(ctx, slug);
  if (!theme) throw notFound(`'${slug}'`);
  const [[item], similar, links] = await Promise.all([
    hydrateThemes(ctx, [theme]),
    similarThemes(ctx, theme, 12),
    comparisonLinks(ctx, { kind: 'theme', entityId: theme.id, limit: 12 }),
  ]);
  const curated = await curatedPairs(
    ctx,
    'theme',
    similar.map((x) => canonicalPair(theme.slug, x.theme.slug)),
  );
  return {
    kind: 'theme',
    slug: theme.slug,
    title: `${theme.name} alternatives`,
    app: null,
    theme: item ?? null,
    category: null,
    items: similar.map((s) => ({
      app: null,
      theme: s.theme,
      shared_stores: 0,
      compare_href: hrefs.compare(canonicalPair(theme.slug, s.theme.slug)),
      compare_available: curated.has(canonicalPair(theme.slug, s.theme.slug)),
      reasons: s.reasons,
    })),
    comparisons: links,
  };
}

async function coInstallCounts(ctx: Ctx, appId: number, alts: AppListItem[]) {
  const rows = await ctx.db.all<{ slug: string; n: number }>(
    `SELECT a.slug, c.store_count AS n FROM app_co_installs c JOIN apps a ON a.id = c.other_app_id
     WHERE c.app_id = ? AND a.slug IN (SELECT value FROM json_each(?))`,
    [appId, jsonIds(alts.map((a) => a.slug))],
  );
  return new Map(rows.map((r) => [r.slug, r.n]));
}

export async function listAlternatives(ctx: Ctx): Promise<ListAlternativesOutput> {
  const [apps, themes] = await Promise.all([
    ctx.db.all<Parameters<typeof appRef>[0] & { stores: number; alternatives: number }>(
      `SELECT COALESCE(st.store_count, 0) AS stores,
         (SELECT COUNT(*) FROM apps o WHERE o.category_id = a.category_id AND o.id <> a.id AND o.status = 'active') AS alternatives,
         ${APP_REF_COLS}
       FROM apps a
       LEFT JOIN app_categories ac ON ac.id = a.category_id
       LEFT JOIN app_stats st ON st.app_id = a.id
       WHERE a.status = 'active' AND COALESCE(st.store_count, 0) > 0
       ORDER BY stores DESC, a.slug`,
    ),
    ctx.db.all<{ slug: string; name: string; stores: number; alternatives: number }>(
      `SELECT t.slug, t.name, COALESCE(ts.store_count, 0) AS stores,
         (SELECT COUNT(*) FROM themes o WHERE o.id <> t.id AND o.status = 'active'
            AND (o.vendor_slug = t.vendor_slug OR o.price_cents = t.price_cents
                 OR (o.price_cents > 0 AND t.price_cents > 0
                     AND abs(o.price_cents - t.price_cents) <= 0.2 * max(o.price_cents, t.price_cents)))) AS alternatives
       FROM themes t LEFT JOIN theme_stats ts ON ts.theme_id = t.id
       WHERE t.status = 'active' ORDER BY stores DESC, t.slug`,
    ),
  ]);
  return {
    apps: apps
      .filter((a) => a.alternatives > 0)
      .map((a) => ({
        app: appRef(a),
        href: hrefs.alternatives(a.app_slug),
        alternatives: a.alternatives,
        stores: a.stores,
      })),
    themes: themes
      .filter((t) => t.alternatives > 0)
      .map((t) => ({
        theme: { slug: t.slug, name: t.name, href: hrefs.theme(t.slug) },
        href: hrefs.alternatives(t.slug),
        alternatives: t.alternatives,
        stores: t.stores,
      })),
  };
}
