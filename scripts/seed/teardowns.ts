/**
 * Teardown files: data/curation/teardowns/*.md with YAML frontmatter.
 *
 *   ---
 *   slug: youngla                # URL slug (/teardowns/<slug>)
 *   store: youngla.com           # store domain (must be a seeded store)
 *   title: ...
 *   dek: ...                     # one-sentence standfirst
 *   published_at: 2026-11-17     # omit or null = draft (not listed)
 *   is_sample: true              # format demo; UI labels it as a sample
 *   notes:                       # numbered callouts tied to a section on the store's captures
 *     - n: 1
 *       page_type: product       # taxonomy PAGE_TYPES slug
 *       device: desktop          # desktop | mobile
 *       section_type: reviews    # taxonomy SECTION_TYPES slug
 *       title: ...
 *       body: ...                # markdown
 *   ---
 *   Markdown body…
 */
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { PAGE_TYPES, SECTION_TYPES } from '../../src/lib/taxonomy.ts';

const pageTypes = PAGE_TYPES.map((p) => p.slug) as [string, ...string[]];
const sectionTypes = SECTION_TYPES.map((s) => s.slug) as [string, ...string[]];

export const TeardownFrontmatter = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  store: z.string(),
  title: z.string().min(1),
  dek: z.string().nullable().optional(),
  published_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .nullable()
    .optional(),
  is_sample: z.boolean().default(false),
  notes: z
    .array(
      z.object({
        n: z.number().int().positive(),
        page_type: z.enum(pageTypes),
        device: z.enum(['desktop', 'mobile']),
        section_type: z.enum(sectionTypes),
        title: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .default([]),
});
export type TeardownFrontmatter = z.infer<typeof TeardownFrontmatter>;

export interface ParsedTeardown {
  frontmatter: TeardownFrontmatter;
  body: string;
}

export function parseTeardown(file: string, source: string): ParsedTeardown {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!m?.[1]) throw new Error(`${file}: missing YAML frontmatter`);
  const parsed = TeardownFrontmatter.safeParse(parseYaml(m[1]));
  if (!parsed.success) throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);
  const ns = parsed.data.notes.map((n) => n.n);
  if (new Set(ns).size !== ns.length) throw new Error(`${file}: duplicate note numbers`);
  return { frontmatter: parsed.data, body: (m[2] ?? '').trim() };
}
