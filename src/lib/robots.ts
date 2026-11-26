/**
 * robots.txt parsing (RFC 9309), shared by the local crawler/capture scripts and the Worker's
 * scheduled crawler: the group for our product token when the file has one, otherwise the `*`
 * group; the longest matching Allow/Disallow wins, Allow on a tie; `*` and a trailing `$` work.
 */
import { SITE_NAME } from '../config/site.ts';

/** The product token stores can name in robots.txt (`User-agent: <token>`). */
export const ROBOTS_TOKEN = `${SITE_NAME}Bot`;

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
