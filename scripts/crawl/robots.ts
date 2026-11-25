/// <reference types="node" />
/**
 * robots.txt for the crawler and the capture pipeline (RFC 9309): the group for our product
 * token (`VitrineBot`) when the file has one, otherwise the `*` group; the longest matching
 * Allow/Disallow wins, Allow on a tie; `*` and a trailing `$` are supported. A missing file
 * (4xx) allows everything; a server error or a timeout disallows (we try again next run).
 */
export const ROBOTS_TOKEN = 'VitrineBot';

interface Rule {
  allow: boolean;
  path: string;
}

export interface Robots {
  /** `pathname + search` of the URL to check. */
  allows(path: string): boolean;
  /** Crawl-delay in seconds for our group, when set. */
  crawlDelay: number | null;
}

export function parseRobots(text: string, token = ROBOTS_TOKEN): Robots {
  const groups: Array<{ agents: string[]; rules: Rule[]; delay: number | null }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.delay = n;
    }
  }
  const mine = groups.filter((g) => g.agents.includes(token.toLowerCase()));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  const delay = chosen.map((g) => g.delay).find((d) => d !== null) ?? null;
  return {
    crawlDelay: delay,
    allows(path: string) {
      let best: Rule | null = null;
      for (const r of rules) {
        if (!matches(r.path, path)) continue;
        if (
          !best ||
          r.path.length > best.path.length ||
          (r.path.length === best.path.length && r.allow)
        )
          best = r;
      }
      return best ? best.allow : true;
    },
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${re}${anchored ? '$' : ''}`).test(path);
}

const ALLOW_ALL: Robots = { allows: () => true, crawlDelay: null };
const DENY_ALL: Robots = { allows: () => false, crawlDelay: null };

/** Fetches and parses https://<domain>/robots.txt (cached per run). */
export async function robotsFor(
  domain: string,
  cache: Map<string, Promise<Robots>> = defaultCache,
): Promise<Robots> {
  let hit = cache.get(domain);
  if (!hit) {
    hit = (async () => {
      try {
        const res = await fetch(`https://${domain}/robots.txt`, {
          headers: { 'User-Agent': `Mozilla/5.0 (compatible; ${ROBOTS_TOKEN})` },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status >= 400 && res.status < 500) return ALLOW_ALL;
        if (!res.ok) return DENY_ALL;
        return parseRobots(await res.text());
      } catch {
        return DENY_ALL;
      }
    })();
    cache.set(domain, hit);
  }
  return hit;
}
const defaultCache = new Map<string, Promise<Robots>>();
