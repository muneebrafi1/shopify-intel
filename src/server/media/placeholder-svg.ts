/**
 * Placeholder screenshots.
 *
 * Until the capture pipeline runs, every screenshot is drawn from its section rows (type, y,
 * height) as a quiet wireframe in the store's tone. Because the drawing comes from the same
 * section data the UI uses for overlays and crops, the experience is identical to a real
 * capture: when a real image lands in R2, only the image URL changes.
 *
 * Output is a plain SVG string (no external fonts or images), safe to cache forever per
 * screenshot + data version.
 */
import { rng, toneFor, type StoreTone } from '~/lib/tone';

export interface PlaceholderSection {
  type: string;
  y: number;
  height: number;
  /** Horizontal bounds for side-by-side slices; full width when omitted. */
  x?: number | null;
  w?: number | null;
  hints?: Record<string, unknown> | null;
}

export interface PlaceholderShot {
  /** Stable seed, normally the store domain. */
  seed: string;
  /** Text drawn as the store logo (store name or domain). */
  label: string;
  device: 'desktop' | 'mobile';
  pageType?: string;
  width: number;
  height: number;
  sections: PlaceholderSection[];
}

export interface RenderOptions {
  /** Render only part of the page (section crops, grid thumbnails). x/width crop sideways. */
  crop?: { y: number; height: number; x?: number | null; width?: number | null };
  /** Output width in px (defaults to the shot width). Height follows the aspect ratio. */
  outputWidth?: number;
}

/* ------------------------------------------------------------------ primitives */

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

class Canvas {
  private parts: string[] = [];
  rect(x: number, y: number, w: number, h: number, fill: string, r = 0, extra = '') {
    if (w <= 0 || h <= 0) return;
    this.parts.push(
      `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}"${r ? ` rx="${r1(r)}"` : ''} fill="${fill}"${extra}/>`,
    );
  }
  /** Rounded bar standing in for a line of text. */
  bar(x: number, y: number, w: number, h: number, fill: string) {
    this.rect(x, y, w, h, fill, h / 2);
  }
  circle(cx: number, cy: number, r: number, fill: string) {
    this.parts.push(`<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${fill}"/>`);
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1) {
    this.parts.push(
      `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${stroke}" stroke-width="${w}"/>`,
    );
  }
  path(d: string, fill: string) {
    this.parts.push(`<path d="${d}" fill="${fill}"/>`);
  }
  text(
    x: number,
    y: number,
    value: string,
    size: number,
    fill: string,
    family: string,
    anchor = 'start',
    weight = 600,
  ) {
    this.parts.push(
      `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-family="${family}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="-0.02em">${esc(value)}</text>`,
    );
  }
  toString() {
    return this.parts.join('');
  }
}

interface Ctx {
  c: Canvas;
  t: StoreTone;
  mobile: boolean;
  W: number;
  /** Content column. */
  cx: number;
  cw: number;
  rand: () => number;
  label: string;
  section: PlaceholderSection;
  all: PlaceholderSection[];
}

const pick = <T>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)] as T;

/** Text block: n bars with decreasing last line. Returns the y after the block. */
function lines(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  n: number,
  opts: { h?: number; gap?: number; color?: string; align?: 'start' | 'center' } = {},
) {
  const h = opts.h ?? (ctx.mobile ? 7 : 9);
  const gap = opts.gap ?? h * 1.25;
  const color = opts.color ?? ctx.t.inkSoft;
  for (let i = 0; i < n; i++) {
    const lw =
      i === n - 1 && n > 1 ? w * (0.45 + ctx.rand() * 0.3) : w * (0.88 + ctx.rand() * 0.12);
    const lx = opts.align === 'center' ? x + (w - lw) / 2 : x;
    ctx.c.bar(lx, y + i * (h + gap), lw, h, color);
  }
  return y + n * (h + gap);
}

function heading(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  opts: {
    size?: 'sm' | 'md' | 'lg';
    align?: 'start' | 'center';
    color?: string;
    lines?: number;
  } = {},
) {
  const base = ctx.mobile ? { sm: 12, md: 18, lg: 26 } : { sm: 16, md: 26, lg: 44 };
  const h = base[opts.size ?? 'md'];
  const n = opts.lines ?? 1;
  const color = opts.color ?? ctx.t.ink;
  // Real section titles are short ("Best sellers"), so cap the bar length per size.
  const cap = (ctx.mobile ? { sm: 150, md: 250, lg: 320 } : { sm: 220, md: 400, lg: 600 })[
    opts.size ?? 'md'
  ];
  const span = Math.min(w, cap);
  for (let i = 0; i < n; i++) {
    const lw = Math.min(w, (i === n - 1 && n > 1 ? 0.6 : 1) * span * (0.7 + ctx.rand() * 0.3));
    const lx = opts.align === 'center' ? x + (w - lw) / 2 : x;
    ctx.c.rect(lx, y + i * h * 1.35, lw, h * 0.78, color, Math.min(6, h * 0.2));
  }
  return y + n * h * 1.35;
}

function button(ctx: Ctx, x: number, y: number, w: number, h: number, filled = true) {
  if (filled) {
    ctx.c.rect(x, y, w, h, ctx.t.button, Math.min(h / 2, 4 + ctx.rand() * 20));
    ctx.c.bar(x + w * 0.3, y + h / 2 - 3, w * 0.4, 6, ctx.t.buttonInk);
  } else {
    ctx.c.rect(x, y, w, h, 'none', h / 2, ` stroke="${ctx.t.ink}" stroke-width="1.2"`);
    ctx.c.bar(x + w * 0.3, y + h / 2 - 3, w * 0.4, 6, ctx.t.ink);
  }
}

/**
 * An "image" well with a soft product silhouette so it reads as photography, not a gray box.
 * `subject` places the silhouette (fractions of the box); defaults to centred.
 */
function image(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  variant = 0,
  radius = 0,
  subject: { x: number; y: number; scale?: number } = { x: 0.5, y: 0.52 },
) {
  const base = variant % 2 === 0 ? ctx.t.tone : ctx.t.surface;
  ctx.c.rect(x, y, w, h, base, radius);
  const shape = Math.floor(ctx.rand() * 3);
  const sw = Math.min(w, h) * (subject.scale ?? 0.36 + ctx.rand() * 0.12);
  const scx = x + w * subject.x;
  const scy = y + h * subject.y;
  if (shape === 0) {
    ctx.c.rect(scx - sw * 0.35, scy - sw * 0.62, sw * 0.7, sw * 1.24, ctx.t.tone2, sw * 0.12);
  } else if (shape === 1) {
    ctx.c.circle(scx, scy, sw * 0.5, ctx.t.tone2);
  } else {
    ctx.c.rect(scx - sw * 0.55, scy - sw * 0.4, sw * 1.1, sw * 0.8, ctx.t.tone2, sw * 0.08);
  }
  // Ground shadow keeps the silhouette from floating.
  ctx.c.rect(
    scx - sw * 0.5,
    scy + sw * 0.66,
    sw,
    Math.max(2, sw * 0.05),
    ctx.t.tone2,
    2,
    ' opacity="0.45"',
  );
}

function productCard(ctx: Ctx, x: number, y: number, w: number, imgH: number, i: number) {
  image(ctx, x, y, w, imgH, i, ctx.mobile ? 4 : 6);
  const ty = y + imgH + (ctx.mobile ? 10 : 14);
  const h = ctx.mobile ? 7 : 9;
  ctx.c.bar(x, ty, w * (0.6 + ctx.rand() * 0.3), h, ctx.t.ink);
  ctx.c.bar(x, ty + h * 2, w * 0.35, h, ctx.t.inkSoft);
}

function grid(ctx: Ctx, y: number, cols: number, rows: number, cardH: number, gap: number) {
  const w = (ctx.cw - gap * (cols - 1)) / cols;
  const imgH = cardH - (ctx.mobile ? 34 : 48);
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      productCard(ctx, ctx.cx + col * (w + gap), y + r * (cardH + gap), w, imgH, i++);
    }
  }
}

function stars(ctx: Ctx, x: number, y: number, size: number, color: string) {
  for (let i = 0; i < 5; i++) {
    const cx = x + i * size * 1.2 + size / 2;
    const cy = y + size / 2;
    const pts = Array.from({ length: 10 }, (_, k) => {
      const a = (Math.PI / 5) * k - Math.PI / 2;
      const rr = k % 2 === 0 ? size / 2 : size / 4.4;
      return `${r1(cx + rr * Math.cos(a))},${r1(cy + rr * Math.sin(a))}`;
    });
    ctx.c.path(`M${pts.join('L')}Z`, color);
  }
}

/* ------------------------------------------------------------------ section drawers */

type Drawer = (ctx: Ctx, y: number, h: number) => void;

const drawers: Record<string, Drawer> = {
  'announcement-bar': (ctx, y, h) => {
    ctx.c.rect(0, y, ctx.W, h, ctx.t.announce);
    const w = ctx.mobile ? 180 : 300;
    ctx.c.bar(ctx.W / 2 - w / 2, y + h / 2 - 3.5, w, 7, ctx.t.announceInk);
  },

  header: (ctx, y, h) => {
    ctx.c.rect(0, y, ctx.W, h, ctx.t.paper);
    ctx.c.line(0, y + h - 0.5, ctx.W, y + h - 0.5, ctx.t.inkSoft);
    const mid = y + h / 2;
    const family =
      ctx.t.logoFont === 'serif'
        ? 'Georgia, Times New Roman, serif'
        : 'Helvetica Neue, Arial, sans-serif';
    const logo = ctx.label.length > 18 ? `${ctx.label.slice(0, 17)}…` : ctx.label;
    if (ctx.mobile) {
      for (let i = 0; i < 3; i++) ctx.c.bar(ctx.cx, mid - 6 + i * 5.5, 18, 2, ctx.t.ink);
      ctx.c.text(ctx.W / 2, mid + 6, logo, 17, ctx.t.ink, family, 'middle');
      ctx.c.circle(ctx.W - ctx.cx - 34, mid, 7, 'none');
      ctx.c.rect(
        ctx.W - ctx.cx - 40,
        mid - 7,
        13,
        13,
        'none',
        7,
        ` stroke="${ctx.t.ink}" stroke-width="1.6"`,
      );
      ctx.c.rect(
        ctx.W - ctx.cx - 16,
        mid - 7,
        15,
        14,
        'none',
        3,
        ` stroke="${ctx.t.ink}" stroke-width="1.6"`,
      );
      return;
    }
    const centered = ctx.rand() > 0.5;
    if (centered) {
      ctx.c.text(ctx.W / 2, mid + 9, logo, 26, ctx.t.ink, family, 'middle');
      let x = ctx.cx;
      for (let i = 0; i < 4; i++) {
        const w = 44 + ctx.rand() * 30;
        ctx.c.bar(x, mid - 4, w, 8, ctx.t.ink);
        x += w + 28;
      }
    } else {
      ctx.c.text(ctx.cx, mid + 9, logo, 26, ctx.t.ink, family, 'start');
      let x = ctx.cx + 260;
      for (let i = 0; i < 5; i++) {
        const w = 44 + ctx.rand() * 30;
        ctx.c.bar(x, mid - 4, w, 8, ctx.t.ink);
        x += w + 28;
      }
    }
    for (let i = 0; i < 3; i++) {
      ctx.c.rect(
        ctx.cx + ctx.cw - 18 - i * 40,
        mid - 9,
        18,
        18,
        'none',
        i === 0 ? 3 : 9,
        ` stroke="${ctx.t.ink}" stroke-width="1.8"`,
      );
    }
  },

  breadcrumbs: (ctx, y, h) => {
    let x = ctx.cx;
    for (let i = 0; i < 3; i++) {
      const w = 40 + ctx.rand() * 40;
      ctx.c.bar(x, y + h / 2 - 3, w, 6, i === 2 ? ctx.t.ink : ctx.t.inkSoft);
      x += w + 18;
    }
  },

  hero: (ctx, y, h) => {
    // Seed hints: style image|video|split (+ text_align). Unknown/missing → seeded variety.
    const hintStyle = ctx.section.hints?.style as string | undefined;
    const align = ctx.section.hints?.text_align as string | undefined;
    const style =
      hintStyle === 'split' || hintStyle === 'video'
        ? hintStyle
        : hintStyle === 'image'
          ? align === 'center'
            ? pick(ctx.rand, ['center', 'center', 'copy-left'])
            : align === 'right'
              ? 'copy-right'
              : 'copy-left'
          : pick(ctx.rand, ['copy-left', 'copy-right', 'center', 'split', 'video', 'center']);
    if (style === 'video') {
      // Dark, full-bleed video hero: a dim scene, centred white copy, a small play control.
      // Footage reads as the store's own colour, darkened (not a generic charcoal).
      ctx.c.rect(0, y, ctx.W, h, ctx.t.tone2);
      ctx.c.rect(0, y, ctx.W, h, '#000', 0, ' opacity="0.55"');
      const sw = Math.min(ctx.W, h) * (ctx.mobile ? 0.7 : 0.55);
      ctx.c.circle(ctx.W * (ctx.mobile ? 0.5 : 0.62), y + h * 0.5, sw * 0.5, ctx.t.tone2);
      ctx.c.rect(0, y, ctx.W, h, '#000', 0, ' opacity="0.25"');
      ctx.c.rect(
        ctx.W * (ctx.mobile ? 0.3 : 0.2),
        y + h * 0.62,
        sw * 0.5,
        sw * 0.6,
        '#000',
        sw * 0.06,
        ' opacity="0.18"',
      );
      const tw = ctx.mobile ? ctx.cw : 560;
      const tx = ctx.W / 2 - tw / 2;
      const after = heading(ctx, tx, y + h * (ctx.mobile ? 0.58 : 0.4), tw, {
        size: 'lg',
        align: 'center',
        color: '#ffffff',
        lines: 2,
      });
      const l = lines(ctx, tx, after + 10, tw, 1, {
        color: 'rgba(255,255,255,0.45)',
        align: 'center',
      });
      const bw = ctx.mobile ? 150 : 180;
      ctx.c.rect(ctx.W / 2 - bw / 2, l + 16, bw, ctx.mobile ? 42 : 48, '#ffffff', 24);
      ctx.c.bar(ctx.W / 2 - bw * 0.2, l + 16 + (ctx.mobile ? 21 : 24) - 3, bw * 0.4, 6, '#1d1c1a');
      const px = ctx.cx + 18;
      const py = y + h - (ctx.mobile ? 40 : 56);
      ctx.c.circle(px, py, ctx.mobile ? 14 : 18, 'rgba(255,255,255,0.18)');
      ctx.c.path(`M${px - 4},${py - 7}L${px + 7},${py}L${px - 4},${py + 7}Z`, '#ffffff');
      return;
    }
    if (style === 'split' && !ctx.mobile) {
      image(ctx, ctx.W / 2, y, ctx.W / 2, h, 0);
      ctx.c.rect(0, y, ctx.W / 2, h, ctx.t.surface);
      const tx = ctx.cx;
      const ty = y + h * 0.36;
      const after = heading(ctx, tx, ty, ctx.W / 2 - ctx.cx * 2, { size: 'lg', lines: 2 });
      const l = lines(ctx, tx, after + 16, 360, 2);
      button(ctx, tx, l + 20, 180, 48);
      return;
    }
    const onDark = !!ctx.t.dark;
    if (style === 'center' || ctx.mobile) {
      // Lifestyle scene: a wide photo with two subjects, copy centred over the clear middle.
      image(
        ctx,
        0,
        y,
        ctx.W,
        h,
        0,
        0,
        ctx.mobile ? { x: 0.5, y: 0.32, scale: 0.6 } : { x: 0.18, y: 0.58, scale: 0.5 },
      );
      if (!ctx.mobile) {
        const sw = h * 0.42;
        ctx.c.rect(
          ctx.W * 0.82 - sw * 0.35,
          y + h * 0.58 - sw * 0.62,
          sw * 0.7,
          sw * 1.24,
          ctx.t.tone2,
          sw * 0.12,
          ' opacity="0.85"',
        );
      }
      const tw = ctx.mobile ? ctx.cw : 560;
      const tx = ctx.W / 2 - tw / 2;
      const ty = y + h * (ctx.mobile ? 0.66 : 0.38);
      const after = heading(ctx, tx, ty, tw, {
        size: 'lg',
        align: 'center',
        color: onDark ? '#ffffff' : ctx.t.ink,
        lines: 2,
      });
      const l = lines(ctx, tx, after + 10, tw, 1, {
        color: onDark ? 'rgba(255,255,255,0.6)' : ctx.t.tone2,
        align: 'center',
      });
      const bw = ctx.mobile ? 150 : 180;
      button(ctx, ctx.W / 2 - bw / 2, l + 16, bw, ctx.mobile ? 42 : 48);
      return;
    }
    // Full-bleed photo: subject on one side, copy in the clear area.
    const copyLeft = style !== 'copy-right';
    image(ctx, 0, y, ctx.W, h, 0, 0, { x: copyLeft ? 0.7 : 0.3, y: 0.5, scale: 0.62 });
    ctx.c.rect(0, y, ctx.W, h, '#000', 0, ' opacity="0.06"');
    const tw = Math.min(520, ctx.cw * 0.4);
    const tx = copyLeft ? ctx.cx : ctx.cx + ctx.cw - tw;
    const ty = y + h * 0.4;
    const after = heading(ctx, tx, ty, tw, {
      size: 'lg',
      color: onDark ? '#ffffff' : ctx.t.ink,
      lines: 2,
    });
    const l = lines(ctx, tx, after + 10, tw, 1, {
      color: onDark ? 'rgba(255,255,255,0.6)' : ctx.t.tone2,
    });
    button(ctx, tx, l + 16, 180, 48);
  },

  slideshow: (ctx, y, h) => {
    drawers.hero!(ctx, y, h);
    const n = 3;
    for (let i = 0; i < n; i++)
      ctx.c.circle(
        ctx.W / 2 + (i - 1) * 16,
        y + h - 22,
        4,
        i === 0 ? '#ffffff' : 'rgba(255,255,255,0.5)',
      );
  },

  'image-with-text': (ctx, y, h) => {
    const pad = ctx.mobile ? 24 : 56;
    if (ctx.mobile) {
      const ih = h * 0.55;
      image(ctx, ctx.cx, y + pad, ctx.cw, ih - pad, 1, 6);
      const after = heading(ctx, ctx.cx, y + ih + 20, ctx.cw, { size: 'md', lines: 2 });
      const l = lines(ctx, ctx.cx, after + 8, ctx.cw, 3);
      button(ctx, ctx.cx, l + 12, 140, 40, false);
      return;
    }
    const flip = ctx.rand() > 0.5;
    const iw = ctx.cw * 0.5;
    const ix = flip ? ctx.cx + ctx.cw - iw : ctx.cx;
    image(ctx, ix, y + pad, iw, h - pad * 2, 1, 6);
    const tx = flip ? ctx.cx : ctx.cx + iw + 72;
    const tw = ctx.cw - iw - 72;
    const after = heading(ctx, tx, y + h / 2 - 60, tw, { size: 'md', lines: 2 });
    const l = lines(ctx, tx, after + 12, tw * 0.9, 3);
    button(ctx, tx, l + 16, 160, 44, false);
  },

  video: (ctx, y, h) => {
    const pad = ctx.mobile ? 0 : 40;
    ctx.c.rect(
      ctx.mobile ? 0 : ctx.cx,
      y + pad,
      ctx.mobile ? ctx.W : ctx.cw,
      h - pad * 2,
      ctx.t.dark ? '#2a2a2a' : '#22201d',
      ctx.mobile ? 0 : 6,
    );
    const cy = y + h / 2;
    ctx.c.circle(ctx.W / 2, cy, 28, 'rgba(255,255,255,0.9)');
    ctx.c.path(
      `M${ctx.W / 2 - 8},${cy - 12}L${ctx.W / 2 + 14},${cy}L${ctx.W / 2 - 8},${cy + 12}Z`,
      '#22201d',
    );
  },

  'logo-list': (ctx, y, h) => {
    const n = ctx.mobile ? 3 : 6;
    const gap = ctx.mobile ? 20 : 48;
    const w = (ctx.cw - gap * (n - 1)) / n;
    heading(ctx, ctx.cx, y + 24, ctx.cw, { size: 'sm', align: 'center', color: ctx.t.inkSoft });
    for (let i = 0; i < n; i++) {
      ctx.c.rect(
        ctx.cx + i * (w + gap) + w * 0.15,
        y + h / 2,
        w * 0.7,
        ctx.mobile ? 14 : 20,
        ctx.t.inkSoft,
        4,
      );
    }
  },

  'featured-collection': (ctx, y, h) => {
    const top = ctx.mobile ? 28 : 56;
    heading(ctx, ctx.cx, y + top, ctx.cw, { size: 'md', align: ctx.mobile ? 'start' : 'center' });
    const cols = ctx.mobile ? 2 : 4;
    const gap = ctx.mobile ? 10 : 24;
    const avail = h - top - (ctx.mobile ? 60 : 100);
    const rows = ctx.mobile ? 2 : 1;
    const cardW = (ctx.cw - gap * (cols - 1)) / cols;
    // Product cards keep a believable portrait ratio; extra height becomes whitespace.
    const cardH = Math.min((avail - gap * (rows - 1)) / rows, cardW * 1.55);
    grid(ctx, y + top + (ctx.mobile ? 40 : 64), cols, rows, cardH, gap);
  },

  'collection-list': (ctx, y, h) => {
    const top = ctx.mobile ? 28 : 56;
    heading(ctx, ctx.cx, y + top, ctx.cw, { size: 'md' });
    const cols = ctx.mobile ? 2 : 3;
    const gap = ctx.mobile ? 10 : 24;
    const w = (ctx.cw - gap * (cols - 1)) / cols;
    const ih = h - top - (ctx.mobile ? 90 : 140);
    for (let i = 0; i < cols; i++) {
      const x = ctx.cx + i * (w + gap);
      image(ctx, x, y + top + (ctx.mobile ? 36 : 60), w, ih, i, 6);
      ctx.c.bar(
        x,
        y + top + (ctx.mobile ? 36 : 60) + ih + 14,
        w * 0.4,
        ctx.mobile ? 8 : 10,
        ctx.t.ink,
      );
    }
  },

  'collection-header': (ctx, y, h) => {
    const banner = ctx.rand() > 0.5;
    if (banner) {
      image(ctx, 0, y, ctx.W, h, 1);
      heading(ctx, ctx.cx, y + h / 2 - 20, ctx.cw, {
        size: 'lg',
        align: 'center',
        color: '#ffffff',
      });
      return;
    }
    const after = heading(ctx, ctx.cx, y + h * 0.3, ctx.cw, {
      size: 'lg',
      align: ctx.mobile ? 'start' : 'center',
    });
    lines(ctx, ctx.mobile ? ctx.cx : ctx.W / 2 - 280, after + 10, ctx.mobile ? ctx.cw : 560, 2, {
      align: ctx.mobile ? 'start' : 'center',
    });
  },

  filters: (ctx, y, h) => {
    ctx.c.line(ctx.cx, y + 0.5, ctx.cx + ctx.cw, y + 0.5, ctx.t.inkSoft);
    ctx.c.line(ctx.cx, y + h - 0.5, ctx.cx + ctx.cw, y + h - 0.5, ctx.t.inkSoft);
    const mid = y + h / 2;
    if (ctx.mobile) {
      ctx.c.rect(
        ctx.cx,
        mid - 16,
        ctx.cw / 2 - 5,
        32,
        'none',
        4,
        ` stroke="${ctx.t.inkSoft}" stroke-width="1.5"`,
      );
      ctx.c.rect(
        ctx.cx + ctx.cw / 2 + 5,
        mid - 16,
        ctx.cw / 2 - 5,
        32,
        'none',
        4,
        ` stroke="${ctx.t.inkSoft}" stroke-width="1.5"`,
      );
      ctx.c.bar(ctx.cx + 40, mid - 3, 60, 6, ctx.t.ink);
      ctx.c.bar(ctx.cx + ctx.cw / 2 + 45, mid - 3, 60, 6, ctx.t.ink);
      return;
    }
    let x = ctx.cx;
    for (let i = 0; i < 4; i++) {
      const w = 90 + ctx.rand() * 30;
      ctx.c.rect(x, mid - 16, w, 32, 'none', 16, ` stroke="${ctx.t.inkSoft}" stroke-width="1.5"`);
      ctx.c.bar(x + 16, mid - 3, w - 44, 6, ctx.t.ink);
      x += w + 10;
    }
    ctx.c.bar(ctx.cx + ctx.cw - 260, mid - 3, 80, 6, ctx.t.inkSoft);
    ctx.c.rect(
      ctx.cx + ctx.cw - 160,
      mid - 16,
      160,
      32,
      'none',
      16,
      ` stroke="${ctx.t.inkSoft}" stroke-width="1.5"`,
    );
  },

  'product-grid': (ctx, y, h) => {
    const cols = ctx.mobile
      ? 2
      : ((ctx.section.hints?.columns as number) ?? pick(ctx.rand, [3, 4, 4]));
    const gap = ctx.mobile ? 10 : 24;
    const w = (ctx.cw - gap * (cols - 1)) / cols;
    const cardH = w * (ctx.mobile ? 1.55 : 1.45);
    const pad = ctx.mobile ? 16 : 32;
    const rows = Math.max(1, Math.floor((h - pad * 2 + gap) / (cardH + gap)));
    grid(ctx, y + pad, cols, rows, cardH, gap);
  },

  upsell: (ctx, y, h) => {
    const top = ctx.mobile ? 24 : 48;
    heading(ctx, ctx.cx, y + top, ctx.cw, { size: ctx.mobile ? 'sm' : 'md' });
    const cols = ctx.mobile ? 2 : 4;
    const gap = ctx.mobile ? 10 : 20;
    const cardW = (ctx.cw - gap * (cols - 1)) / cols;
    const cardH = Math.min(h - top - (ctx.mobile ? 60 : 96), cardW * 1.55);
    grid(ctx, y + top + (ctx.mobile ? 34 : 56), cols, 1, cardH, gap);
  },

  'recently-viewed': (ctx, y, h) => drawers.upsell!(ctx, y, h),

  'product-gallery': (ctx, y, h) => {
    const pad = ctx.mobile ? 0 : 32;
    if (ctx.mobile) {
      image(ctx, 0, y, ctx.W, h - 24, 0);
      for (let i = 0; i < 4; i++)
        ctx.c.circle(
          ctx.W / 2 + (i - 1.5) * 12,
          y + h - 12,
          3,
          i === 0 ? ctx.t.ink : ctx.t.inkSoft,
        );
      return;
    }
    // Desktop: gallery on the left. If no separate buy-box section shares this row, draw it too.
    const shared = ctx.all.some(
      (s) => s.type === 'buy-box' && s.y < y + h && s.y + s.height > y && s !== ctx.section,
    );
    const sx = ctx.section.x ?? null;
    const gx = sx != null && ctx.section.w ? Math.max(ctx.cx, sx) : ctx.cx;
    const gw =
      sx != null && ctx.section.w ? Math.min(ctx.section.w, ctx.cx + ctx.cw - gx) : ctx.cw * 0.56;
    const thumbs = ctx.rand() > 0.5;
    const tw = thumbs ? 72 : 0;
    image(
      ctx,
      gx + (thumbs ? tw + 16 : 0),
      y + pad,
      gw - (thumbs ? tw + 16 : 0),
      h - pad * 2,
      0,
      4,
    );
    if (thumbs) {
      for (let i = 0; i < 4; i++)
        ctx.c.rect(gx, y + pad + i * 88, tw, 76, i === 0 ? ctx.t.tone2 : ctx.t.tone, 4);
    }
    if (!shared) buyBox(ctx, ctx.cx + gw + 56, y + pad, ctx.cw - gw - 56);
  },

  'buy-box': (ctx, y, h) => {
    if (ctx.mobile) {
      buyBox(ctx, ctx.cx, y + 20, ctx.cw);
      return;
    }
    if (ctx.section.x != null && ctx.section.w) {
      const bx = Math.max(ctx.section.x + 40, ctx.cx);
      buyBox(ctx, bx, y + 32, Math.min(ctx.section.w - 40, ctx.cx + ctx.cw - bx));
      return;
    }
    const gw = ctx.cw * 0.56;
    const shared = ctx.all.some(
      (s) => s.type === 'product-gallery' && s.y < y + h && s.y + s.height > y,
    );
    if (shared) buyBox(ctx, ctx.cx + gw + 56, y + 32, ctx.cw - gw - 56);
    else buyBox(ctx, ctx.cx, y + 32, Math.min(560, ctx.cw));
  },

  'product-details': (ctx, y, h) =>
    accordion(ctx, y + (ctx.mobile ? 16 : 32), h - (ctx.mobile ? 32 : 64)),
  faq: (ctx, y, h) => {
    const after = heading(ctx, ctx.cx, y + (ctx.mobile ? 28 : 56), ctx.cw, {
      size: 'md',
      align: ctx.mobile ? 'start' : 'center',
    });
    accordion(ctx, after + 16, h - (after - y) - 40, ctx.mobile ? undefined : 760);
  },

  reviews: (ctx, y, h) => {
    const top = ctx.mobile ? 28 : 56;
    const after = heading(ctx, ctx.cx, y + top, ctx.cw, { size: 'md', align: 'center' });
    const s = ctx.mobile ? 16 : 20;
    stars(ctx, ctx.W / 2 - (s * 1.2 * 5) / 2, after + 4, s, ctx.t.ink);
    ctx.c.bar(ctx.W / 2 - 60, after + s + 16, 120, 7, ctx.t.inkSoft);
    const listTop = after + s + 52;
    const cols = ctx.mobile ? 1 : 3;
    const gap = ctx.mobile ? 12 : 24;
    const w = (ctx.cw - gap * (cols - 1)) / cols;
    const cardH = ctx.mobile ? 150 : 210;
    const rows = Math.max(1, Math.floor((y + h - listTop - 24) / (cardH + gap)));
    const photos = ctx.rand() > 0.4;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = ctx.cx + col * (w + gap);
        const cy = listTop + r * (cardH + gap);
        ctx.c.rect(x, cy, w, cardH, ctx.t.surface, 8);
        stars(ctx, x + 16, cy + 18, 11, ctx.t.ink);
        ctx.c.bar(x + 16, cy + 40, w * 0.35, 8, ctx.t.ink);
        lines(ctx, x + 16, cy + 60, w - 32 - (photos ? 72 : 0), 3);
        if (photos) ctx.c.rect(x + w - 72, cy + 40, 56, 56, ctx.t.tone, 4);
      }
    }
  },

  testimonials: (ctx, y, h) => {
    const mid = y + h / 2;
    ctx.c.text(
      ctx.W / 2,
      mid - (ctx.mobile ? 30 : 50),
      '“',
      ctx.mobile ? 56 : 88,
      ctx.t.inkSoft,
      'Georgia, serif',
      'middle',
      400,
    );
    heading(ctx, ctx.mobile ? ctx.cx : ctx.W / 2 - 360, mid - 10, ctx.mobile ? ctx.cw : 720, {
      size: 'md',
      align: 'center',
      lines: 2,
    });
    ctx.c.bar(ctx.W / 2 - 50, mid + (ctx.mobile ? 50 : 70), 100, 7, ctx.t.inkSoft);
  },

  'ugc-gallery': (ctx, y, h) => {
    const top = ctx.mobile ? 24 : 48;
    heading(ctx, ctx.cx, y + top, ctx.cw, { size: ctx.mobile ? 'sm' : 'md', align: 'center' });
    const n = ctx.mobile ? 3 : 5;
    const gap = ctx.mobile ? 4 : 8;
    const w = (ctx.W - gap * (n - 1)) / n;
    const ih = Math.min(w * (ctx.mobile ? 1.6 : 1.25), h - top - (ctx.mobile ? 50 : 90));
    for (let i = 0; i < n; i++)
      image(ctx, i * (w + gap), y + top + (ctx.mobile ? 34 : 60), w, ih, i);
  },

  'trust-badges': (ctx, y, h) => {
    const n = ctx.mobile ? 3 : 4;
    const w = ctx.cw / n;
    for (let i = 0; i < n; i++) {
      const cx = ctx.cx + i * w + w / 2;
      ctx.c.rect(
        cx - 14,
        y + h / 2 - 26,
        28,
        28,
        'none',
        14,
        ` stroke="${ctx.t.ink}" stroke-width="1.5"`,
      );
      ctx.c.bar(cx - w * 0.3, y + h / 2 + 12, w * 0.6, 7, ctx.t.inkSoft);
    }
  },

  newsletter: (ctx, y, h) => {
    ctx.c.rect(0, y, ctx.W, h, ctx.t.surface);
    const mid = y + h / 2;
    const after = heading(ctx, ctx.cx, mid - (ctx.mobile ? 56 : 70), ctx.cw, {
      size: 'md',
      align: 'center',
    });
    lines(ctx, ctx.mobile ? ctx.cx : ctx.W / 2 - 220, after + 4, ctx.mobile ? ctx.cw : 440, 1, {
      align: 'center',
    });
    const fw = ctx.mobile ? ctx.cw : 440;
    const fx = ctx.W / 2 - fw / 2;
    const fy = after + (ctx.mobile ? 30 : 36);
    ctx.c.rect(
      fx,
      fy,
      fw,
      ctx.mobile ? 42 : 48,
      ctx.t.paper,
      4,
      ` stroke="${ctx.t.inkSoft}" stroke-width="1.5"`,
    );
    ctx.c.rect(
      fx + fw - (ctx.mobile ? 100 : 120),
      fy,
      ctx.mobile ? 100 : 120,
      ctx.mobile ? 42 : 48,
      ctx.t.button,
      4,
    );
  },

  'shipping-bar': (ctx, y, h) => {
    const w = ctx.mobile ? ctx.cw : Math.min(720, ctx.cw);
    const x = ctx.W / 2 - w / 2;
    ctx.c.bar(ctx.W / 2 - 130, y + h / 2 - 16, 260, 8, ctx.t.ink);
    ctx.c.rect(x, y + h / 2 + 4, w, 8, ctx.t.inkSoft, 4);
    ctx.c.rect(x, y + h / 2 + 4, w * (0.45 + ctx.rand() * 0.4), 8, ctx.t.button, 4);
  },

  loyalty: (ctx, y, h) => {
    ctx.c.rect(
      ctx.mobile ? 0 : ctx.cx,
      y + 24,
      ctx.mobile ? ctx.W : ctx.cw,
      h - 48,
      ctx.t.tone,
      ctx.mobile ? 0 : 10,
    );
    const after = heading(ctx, ctx.cx + 24, y + 64, ctx.cw - 48, { size: 'md', align: 'center' });
    const n = ctx.mobile ? 1 : 3;
    const gap = 20;
    const w = (ctx.cw - 48 - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const x = ctx.cx + 24 + i * (w + gap);
      ctx.c.rect(x, after + 20, w, Math.min(140, h - (after - y) - 80), ctx.t.paper, 8);
      ctx.c.circle(x + 30, after + 50, 12, ctx.t.tone2);
      ctx.c.bar(x + 52, after + 46, w * 0.4, 8, ctx.t.ink);
    }
  },

  'cart-items': (ctx, y, h) => {
    const top = ctx.mobile ? 24 : 48;
    heading(ctx, ctx.cx, y + top, ctx.cw, { size: 'lg' });
    const rowH = ctx.mobile ? 120 : 140;
    const start = y + top + (ctx.mobile ? 50 : 80);
    const rows = Math.max(1, Math.floor((y + h - start) / rowH));
    const w = ctx.mobile ? ctx.cw : ctx.cw * 0.62;
    for (let i = 0; i < rows; i++) {
      const ry = start + i * rowH;
      ctx.c.line(ctx.cx, ry, ctx.cx + w, ry, ctx.t.inkSoft);
      image(ctx, ctx.cx, ry + 16, ctx.mobile ? 80 : 100, ctx.mobile ? 88 : 108, i, 4);
      const tx = ctx.cx + (ctx.mobile ? 96 : 124);
      ctx.c.bar(tx, ry + 24, w * 0.32, 9, ctx.t.ink);
      ctx.c.bar(tx, ry + 44, w * 0.18, 7, ctx.t.inkSoft);
      ctx.c.rect(
        tx,
        ry + (ctx.mobile ? 70 : 80),
        96,
        30,
        'none',
        4,
        ` stroke="${ctx.t.inkSoft}" stroke-width="1.5"`,
      );
      ctx.c.bar(ctx.cx + w - 60, ry + 24, 60, 9, ctx.t.ink);
    }
  },

  'cart-summary': (ctx, y, h) => {
    const w = ctx.mobile ? ctx.cw : ctx.cw * 0.32;
    const x = ctx.mobile ? ctx.cx : ctx.cx + ctx.cw - w;
    const top = ctx.mobile ? y + 16 : y - Math.min(h, 360) * 0; // desktop summary sits in its own row
    ctx.c.rect(x, top, w, h - 32, ctx.t.surface, 8);
    ctx.c.bar(x + 20, top + 28, w * 0.3, 9, ctx.t.ink);
    ctx.c.bar(x + w - 20 - w * 0.2, top + 28, w * 0.2, 9, ctx.t.ink);
    lines(ctx, x + 20, top + 56, w - 40, 2);
    const by = top + h - 32 - (ctx.mobile ? 130 : 140);
    button(ctx, x + 20, by, w - 40, 48);
    const ew = (w - 40 - 16) / 3;
    for (let i = 0; i < 3; i++)
      ctx.c.rect(
        x + 20 + i * (ew + 8),
        by + 62,
        ew,
        40,
        i === 0 ? '#5a31f4' : ctx.t.ink,
        4,
        ' opacity="0.9"',
      );
  },

  'rich-text': (ctx, y, h) => {
    const w = ctx.mobile ? ctx.cw : 720;
    const x = ctx.W / 2 - w / 2;
    const after = heading(ctx, x, y + h / 2 - 50, w, { size: 'md', align: 'center', lines: 2 });
    lines(ctx, x, after + 8, w, 2, { align: 'center' });
  },

  'blog-posts': (ctx, y, h) => {
    const top = ctx.mobile ? 24 : 48;
    heading(ctx, ctx.cx, y + top, ctx.cw, { size: 'md' });
    const cols = ctx.mobile ? 1 : 3;
    const gap = 24;
    const w = (ctx.cw - gap * (cols - 1)) / cols;
    const ih = Math.min(w * 0.66, h - top - 140);
    for (let i = 0; i < cols; i++) {
      const x = ctx.cx + i * (w + gap);
      image(ctx, x, y + top + 56, w, ih, i + 1, 6);
      lines(ctx, x, y + top + 72 + ih, w, 2, { color: ctx.t.ink, h: 9 });
    }
  },

  footer: (ctx, y, h) => {
    ctx.c.rect(0, y, ctx.W, h, ctx.t.footer);
    if (ctx.t.footer === ctx.t.paper) ctx.c.line(0, y + 0.5, ctx.W, y + 0.5, ctx.t.footerSoft);
    const top = y + (ctx.mobile ? 32 : 64);
    if (ctx.mobile) {
      for (let i = 0; i < 4; i++) {
        const ry = top + i * 52;
        ctx.c.bar(ctx.cx, ry + 16, 110, 8, ctx.t.footerInk);
        ctx.c.line(ctx.cx, ry + 44, ctx.cx + ctx.cw, ry + 44, ctx.t.footerSoft);
      }
    } else {
      const cols = 4;
      const w = ctx.cw / (cols + 1);
      for (let col = 0; col < cols; col++) {
        const x = ctx.cx + col * w;
        ctx.c.bar(x, top, w * 0.4, 9, ctx.t.footerInk);
        for (let i = 0; i < 5; i++)
          ctx.c.bar(x, top + 30 + i * 22, w * (0.35 + ctx.rand() * 0.3), 7, ctx.t.footerSoft);
      }
      const nx = ctx.cx + cols * w;
      ctx.c.bar(nx, top, w * 0.6, 9, ctx.t.footerInk);
      ctx.c.rect(
        nx,
        top + 30,
        w,
        40,
        'none',
        4,
        ` stroke="${ctx.t.footerSoft}" stroke-width="1.5"`,
      );
    }
    const by = y + h - (ctx.mobile ? 56 : 64);
    ctx.c.line(ctx.cx, by - 16, ctx.cx + ctx.cw, by - 16, ctx.t.footerSoft);
    for (let i = 0; i < (ctx.mobile ? 5 : 7); i++) {
      ctx.c.rect(
        (ctx.mobile ? ctx.cx : ctx.cx + ctx.cw - 7 * 44) + i * 44,
        by,
        36,
        22,
        ctx.t.footerSoft,
        3,
      );
    }
    if (!ctx.mobile) ctx.c.bar(ctx.cx, by + 7, 180, 7, ctx.t.footerSoft);
  },
};

function buyBox(ctx: Ctx, x: number, y: number, w: number) {
  ctx.c.bar(x, y, w * 0.3, 7, ctx.t.inkSoft);
  const after = heading(ctx, x, y + 22, w, { size: ctx.mobile ? 'md' : 'md', lines: 2 });
  stars(ctx, x, after + 2, ctx.mobile ? 11 : 13, ctx.t.ink);
  ctx.c.bar(x + 80, after + 4, 60, 7, ctx.t.inkSoft);
  ctx.c.bar(x, after + 30, 90, ctx.mobile ? 12 : 14, ctx.t.ink);
  let yy = after + 66;
  ctx.c.bar(x, yy, 60, 7, ctx.t.inkSoft);
  yy += 18;
  for (let i = 0; i < 5; i++)
    ctx.c.rect(
      x + i * 54,
      yy,
      46,
      36,
      'none',
      4,
      ` stroke="${i === 1 ? ctx.t.ink : ctx.t.inkSoft}" stroke-width="1.5"`,
    );
  yy += 56;
  button(ctx, x, yy, w, ctx.mobile ? 46 : 52);
  yy += ctx.mobile ? 58 : 64;
  button(ctx, x, yy, w, ctx.mobile ? 46 : 52, false);
  yy += ctx.mobile ? 66 : 76;
  lines(ctx, x, yy, w, 3);
}

function accordion(ctx: Ctx, y: number, h: number, maxW?: number) {
  const w = maxW ? Math.min(maxW, ctx.cw) : ctx.cw;
  const x = ctx.W / 2 - w / 2;
  const rowH = ctx.mobile ? 52 : 60;
  const rows = Math.max(2, Math.floor(h / rowH));
  for (let i = 0; i < rows; i++) {
    const ry = y + i * rowH;
    ctx.c.line(x, ry, x + w, ry, ctx.t.inkSoft);
    ctx.c.bar(x, ry + rowH / 2 - 4, w * (0.25 + ctx.rand() * 0.25), 8, ctx.t.ink);
    ctx.c.bar(x + w - 14, ry + rowH / 2 - 1, 14, 2, ctx.t.ink);
    ctx.c.bar(x + w - 8, ry + rowH / 2 - 7, 2, 14, ctx.t.ink);
  }
}

const fallback: Drawer = (ctx, y, h) => {
  const after = heading(ctx, ctx.cx, y + Math.min(48, h * 0.2), ctx.cw, { size: 'md' });
  lines(
    ctx,
    ctx.cx,
    after + 8,
    ctx.cw * 0.6,
    Math.max(1, Math.min(4, Math.floor((h - (after - y)) / 30))),
  );
};

/* ------------------------------------------------------------------ entry point */

export function renderPlaceholderSvg(shot: PlaceholderShot, opts: RenderOptions = {}): string {
  const t = toneFor(shot.seed);
  const mobile = shot.device === 'mobile';
  const W = shot.width;
  const cw = mobile ? W - 32 : Math.min(1280, W - 160);
  const cx = (W - cw) / 2;
  const c = new Canvas();
  const crop = opts.crop ?? { y: 0, height: shot.height };
  const top = Math.max(0, crop.y);
  const bottom = Math.min(shot.height, crop.y + crop.height);

  c.rect(0, top, W, bottom - top, t.paper);
  const sorted = [...shot.sections].sort((a, b) => a.y - b.y);
  for (const section of sorted) {
    // Skip sections entirely outside the crop (thumbnails only draw what's visible).
    if (section.y + section.height < top || section.y > bottom) continue;
    const ctx: Ctx = {
      c,
      t,
      mobile,
      W,
      cx,
      cw,
      rand: rng(`${shot.seed}|${shot.device}|${shot.pageType ?? ''}|${section.type}|${section.y}`),
      label: shot.label,
      section,
      all: sorted,
    };
    (drawers[section.type] ?? fallback)(ctx, section.y, section.height);
  }

  const left = Math.max(0, crop.x ?? 0);
  const cropW = Math.min(W - left, crop.width ?? W);
  const outW = opts.outputWidth ?? cropW;
  const outH = Math.round(((bottom - top) / cropW) * outW);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(left)} ${r1(top)} ${r1(cropW)} ${r1(bottom - top)}" width="${outW}" height="${outH}" preserveAspectRatio="xMidYMin slice">` +
    `<defs><clipPath id="p"><rect x="${r1(left)}" y="${r1(top)}" width="${r1(cropW)}" height="${r1(bottom - top)}"/></clipPath></defs>` +
    `<g clip-path="url(#p)">${c.toString()}</g></svg>`
  );
}
