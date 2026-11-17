/**
 * A small, strict Markdown renderer for editorial teardown bodies and notes (our own files in
 * data/curation/teardowns). Supports what the format uses: ## / ### headings, paragraphs,
 * **bold**, *italic*, `code`, [links](/path), - and 1. lists, > quotes and ---. Everything is
 * HTML-escaped first; links only allow site paths and https URLs.
 *
 * Quotes: a quote that opens with "**Sample teardown.**" (or "**Note.**") is an editor's note;
 * any other quote is a pull quote.
 */

export interface MdHeading {
  id: string;
  text: string;
  level: 2 | 3;
}
export interface MdResult {
  html: string;
  headings: MdHeading[];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const safeHref = (href: string) => (/^(\/(?!\/)|#|https:\/\/)/.test(href) ? href : null);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Inline markdown → HTML (input is raw text; escaping happens here). */
export function inline(src: string): string {
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, href: string) => {
    const ok = safeHref(href.replace(/&amp;/g, '&'));
    if (!ok) return text;
    const external = ok.startsWith('https://');
    return `<a href="${escapeHtml(ok)}"${external ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)] ?? '');
}

/** Plain text of an inline string (for headings, TOC, titles). */
export function plain(src: string): string {
  return src
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

export function renderMarkdown(src: string, opts: { headingPrefix?: boolean } = {}): MdResult {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const headings: MdHeading[] = [];
  const used = new Set<string>();
  let i = 0;
  let h2 = 0;

  const isBlank = (l: string | undefined) => l === undefined || l.trim() === '';
  const isUl = (l: string) => /^\s*[-*]\s+/.test(l);
  const isOl = (l: string) => /^\s*\d+[.)]\s+/.test(l);
  const isSpecial = (l: string) => /^(#{2,3})\s/.test(l) || /^>/.test(l) || isUl(l) || isOl(l) || /^-{3,}\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length as 2 | 3;
      const text = plain(h[2]!.trim());
      let id = slugify(text) || `section-${headings.length + 1}`;
      while (used.has(id)) id = `${id}-x`;
      used.add(id);
      headings.push({ id, text, level });
      if (level === 2) {
        h2++;
        const n = String(h2).padStart(2, '0');
        out.push(
          `<h2 id="${id}">${opts.headingPrefix ? `<span class="md-n">${n}</span>` : ''}<span>${inline(h[2]!.trim())}</span></h2>`,
        );
      } else {
        out.push(`<h3 id="${id}">${inline(h[2]!.trim())}</h3>`);
      }
      i++;
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }
    if (/^>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      const text = buf.join('\n').trim();
      const paras = text.split(/\n\s*\n/).map((p) => `<p>${inline(p.replace(/\n/g, ' '))}</p>`);
      const isNote = /^\*\*(sample teardown|note|editor[’']?s note)[^*]*\*\*/i.test(text);
      out.push(
        isNote
          ? `<aside class="md-note"><p class="md-note__label">Editor’s note</p>${paras.join('')}</aside>`
          : `<blockquote class="md-pull">${paras.join('')}</blockquote>`,
      );
      continue;
    }
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? isOl(lines[i]!) : isUl(lines[i]!))) {
        let item = lines[i]!.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, '');
        i++;
        // Continuation lines (indented, not a new item).
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !isUl(lines[i]!) && !isOl(lines[i]!)) {
          item += ` ${lines[i]!.trim()}`;
          i++;
        }
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol class="md-ol">${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && !isSpecial(lines[i]!)) {
      buf.push(lines[i]!.trim());
      i++;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return { html: out.join('\n'), headings };
}
