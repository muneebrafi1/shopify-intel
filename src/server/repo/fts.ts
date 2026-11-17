/**
 * Builds a safe FTS5 MATCH expression from user input: every word becomes a quoted prefix term
 * ("pre"*), all terms must match, and only the title + keywords columns are searched.
 * Returns null when the input has no searchable characters.
 */
export function ftsPrefixQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return `{title keywords} : (${terms.map((t) => `"${t}"*`).join(' AND ')})`;
}
