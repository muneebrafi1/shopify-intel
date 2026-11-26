/// <reference types="node" />
/**
 * robots.txt for the crawler and the capture pipeline (RFC 9309): the group for our product
 * token (`VitrineBot`) when the file has one, otherwise the `*` group; the longest matching
 * Allow/Disallow wins, Allow on a tie; `*` and a trailing `$` are supported. A missing file
 * (4xx) allows everything; a server error or a timeout disallows (we try again next run).
 */
import { parseRobots, ROBOTS_TOKEN, type Robots } from '../../src/lib/robots.ts';

export { parseRobots, ROBOTS_TOKEN, type Robots };

/**
 * Where the token's `+url` points: what the bot does and how a store opts out. Override with
 * BOT_INFO_URL once the final domain is live.
 */
export const BOT_INFO_URL =
  process.env.BOT_INFO_URL ??
  'https://vitrine-preview.iammuneebrafi.workers.dev/methodology#crawler';

/** Appended to every browser user agent we send, so stores can see (and block) who we are. */
export const BOT_UA_SUFFIX = `${ROBOTS_TOKEN}/1.0 (+${BOT_INFO_URL})`;

/** A real browser user agent (layouts depend on it) that also identifies the bot. */
export const identify = (browserUa: string) => `${browserUa} ${BOT_UA_SUFFIX}`;

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
      // One retry: a network blip must not read as "disallowed" (unreachable still denies).
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(`https://${domain}/robots.txt`, {
            headers: { 'User-Agent': `Mozilla/5.0 (compatible; ${BOT_UA_SUFFIX})` },
            signal: AbortSignal.timeout(15_000),
          });
          if (res.status >= 400 && res.status < 500) return ALLOW_ALL;
          if (!res.ok) {
            if (attempt < 2) continue;
            return DENY_ALL;
          }
          return parseRobots(await res.text());
        } catch {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          return DENY_ALL;
        }
      }
    })();
    cache.set(domain, hit);
  }
  return hit;
}
const defaultCache = new Map<string, Promise<Robots>>();
