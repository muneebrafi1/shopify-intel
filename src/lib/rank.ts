/**
 * Standard competition ranking ("1224"): items with equal values share a rank and the next rank
 * skips by the size of the tie (1, 2, 2, 4). Higher values rank first. The API's `usage.rank` and
 * `category_rank` are computed the same way in SQL (`RANK()` in src/server/repo/maintenance.ts);
 * use this when numbering a list in memory so a page never shows two different numbers for equal
 * usage. Display order within a tie is the caller's (the API orders ties by name).
 *
 *   competitionRanks([20, 14, 8, 8, 8, 7]) → [1, 2, 3, 3, 3, 6]
 */
export function competitionRanks(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => b - a);
  const firstIndex = new Map<number, number>();
  sorted.forEach((v, i) => {
    if (!firstIndex.has(v)) firstIndex.set(v, i);
  });
  return values.map((v) => (firstIndex.get(v) ?? 0) + 1);
}

/** Competition rank of `value` among `values` (1 + how many are strictly higher). */
export function competitionRank(value: number, values: readonly number[]): number {
  return 1 + values.filter((v) => v > value).length;
}
