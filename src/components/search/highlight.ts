/**
 * Split a title into plain and matched parts for a query, matching the start of words only
 * (the same rule the search index uses: prefix match per word).
 */
export interface Part {
  text: string;
  hit: boolean;
}

export function queryWords(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function highlightParts(text: string, words: string[]): Part[] {
  if (!words.length) return [{ text, hit: false }];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'giu');
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    const before = at === 0 ? '' : text.charAt(at - 1);
    if (before && /[\p{L}\p{N}]/u.test(before)) continue;
    if (at > last) parts.push({ text: text.slice(last, at), hit: false });
    parts.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}
