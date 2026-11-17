/**
 * Deterministic, muted palettes per store. Used for store marks and for drawing placeholder
 * screenshots, so each pending capture is recognisable without pretending to be a real capture.
 * Palettes are deliberately earthy and low-chroma: they sit quietly next to real screenshots.
 */

export interface StoreTone {
  name: string;
  /** Store page background. */
  paper: string;
  /** Cards / panels on the page. */
  surface: string;
  /** Image placeholders: base and secondary. */
  tone: string;
  tone2: string;
  /** Headline and body text bars. */
  ink: string;
  inkSoft: string;
  /** Primary buttons. */
  button: string;
  buttonInk: string;
  footer: string;
  footerInk: string;
  footerSoft: string;
  announce: string;
  announceInk: string;
  /** Store mark (list avatar). */
  mark: string;
  markInk: string;
  /** Whether the storefront is dark (affects hairlines). */
  dark?: boolean;
  /** Logo typeface family for the placeholder header. */
  logoFont: 'serif' | 'sans';
}

const TONES: StoreTone[] = [
  {
    name: 'sand',
    paper: '#ffffff',
    surface: '#f7f4ef',
    tone: '#e6dccd',
    tone2: '#cdbba2',
    ink: '#2a2622',
    inkSoft: '#ddd6cc',
    button: '#2a2622',
    buttonInk: '#ffffff',
    footer: '#f3eee7',
    footerInk: '#2a2622',
    footerSoft: '#d9d1c5',
    announce: '#2a2622',
    announceInk: '#8f877c',
    mark: '#e6dccd',
    markInk: '#5b4e3d',
    logoFont: 'serif',
  },
  {
    name: 'sage',
    paper: '#fbfcf9',
    surface: '#f1f4ee',
    tone: '#d3dccb',
    tone2: '#a9b89f',
    ink: '#23302a',
    inkSoft: '#d5dbd0',
    button: '#2f4a3a',
    buttonInk: '#ffffff',
    footer: '#e8eee4',
    footerInk: '#23302a',
    footerSoft: '#c7d1c0',
    announce: '#2f4a3a',
    announceInk: '#8ea596',
    mark: '#d3dccb',
    markInk: '#3f5546',
    logoFont: 'sans',
  },
  {
    name: 'clay',
    paper: '#ffffff',
    surface: '#faf3ef',
    tone: '#edd3c6',
    tone2: '#d6ab95',
    ink: '#3a2a22',
    inkSoft: '#e6d9d1',
    button: '#9c4a2e',
    buttonInk: '#ffffff',
    footer: '#f6eae3',
    footerInk: '#3a2a22',
    footerSoft: '#e1cbbf',
    announce: '#9c4a2e',
    announceInk: '#dca58f',
    mark: '#edd3c6',
    markInk: '#7c3f29',
    logoFont: 'serif',
  },
  {
    name: 'slate',
    paper: '#ffffff',
    surface: '#f3f5f7',
    tone: '#d9e0e7',
    tone2: '#adb9c6',
    ink: '#1f2933',
    inkSoft: '#dde2e7',
    button: '#1f2933',
    buttonInk: '#ffffff',
    footer: '#1f2933',
    footerInk: '#e6eaee',
    footerSoft: '#3b4754',
    announce: '#e8edf2',
    announceInk: '#8996a3',
    mark: '#d9e0e7',
    markInk: '#3c4a58',
    logoFont: 'sans',
  },
  {
    name: 'ink',
    paper: '#141414',
    surface: '#1d1d1d',
    tone: '#2a2a2a',
    tone2: '#3b3b3b',
    ink: '#f2f2f2',
    inkSoft: '#3a3a3a',
    button: '#f2f2f2',
    buttonInk: '#141414',
    footer: '#0b0b0b',
    footerInk: '#f2f2f2',
    footerSoft: '#2c2c2c',
    announce: '#f2f2f2',
    announceInk: '#8a8a8a',
    mark: '#2a2a2a',
    markInk: '#e8e8e8',
    dark: true,
    logoFont: 'sans',
  },
  {
    name: 'rose',
    paper: '#fffbfa',
    surface: '#fbf0ee',
    tone: '#f0d8d3',
    tone2: '#dcb2aa',
    ink: '#3b2523',
    inkSoft: '#ecdcd8',
    button: '#3b2523',
    buttonInk: '#ffffff',
    footer: '#f7e9e6',
    footerInk: '#3b2523',
    footerSoft: '#e6cfca',
    announce: '#c9776a',
    announceInk: '#f3cdc6',
    mark: '#f0d8d3',
    markInk: '#7a4a43',
    logoFont: 'serif',
  },
  {
    name: 'butter',
    paper: '#fffdf7',
    surface: '#faf5e6',
    tone: '#f0e5c0',
    tone2: '#dbc98d',
    ink: '#2e2a1d',
    inkSoft: '#ece5d0',
    button: '#2e2a1d',
    buttonInk: '#fffdf7',
    footer: '#2e2a1d',
    footerInk: '#f6f0dc',
    footerSoft: '#4a4431',
    announce: '#f0e5c0',
    announceInk: '#a69a6f',
    mark: '#f0e5c0',
    markInk: '#6b5d2d',
    logoFont: 'sans',
  },
  {
    name: 'navy',
    paper: '#ffffff',
    surface: '#f2f5f9',
    tone: '#d8e0ec',
    tone2: '#a2b3cd',
    ink: '#14213d',
    inkSoft: '#dce2ec',
    button: '#14213d',
    buttonInk: '#ffffff',
    footer: '#14213d',
    footerInk: '#e3e8f1',
    footerSoft: '#2d3b5c',
    announce: '#14213d',
    announceInk: '#7f8db0',
    mark: '#d8e0ec',
    markInk: '#2a3d66',
    logoFont: 'serif',
  },
  {
    name: 'olive',
    paper: '#faf9f4',
    surface: '#f1f0e6',
    tone: '#dddcc4',
    tone2: '#b9b791',
    ink: '#2c2c1e',
    inkSoft: '#e1e0d0',
    button: '#4e5130',
    buttonInk: '#ffffff',
    footer: '#ecebdd',
    footerInk: '#2c2c1e',
    footerSoft: '#d3d2bd',
    announce: '#4e5130',
    announceInk: '#9fa27c',
    mark: '#dddcc4',
    markInk: '#535630',
    logoFont: 'sans',
  },
  {
    name: 'terracotta',
    paper: '#f6f0e9',
    surface: '#efe5da',
    tone: '#e2c8b0',
    tone2: '#c79e7c',
    ink: '#2b1d14',
    inkSoft: '#e4d7c9',
    button: '#b4542d',
    buttonInk: '#ffffff',
    footer: '#2b1d14',
    footerInk: '#f2e8de',
    footerSoft: '#4a3628',
    announce: '#b4542d',
    announceInk: '#e9b49a',
    mark: '#e2c8b0',
    markInk: '#8a3f22',
    logoFont: 'serif',
  },
  {
    name: 'mono',
    paper: '#ffffff',
    surface: '#f5f5f5',
    tone: '#ececec',
    tone2: '#d2d2d2',
    ink: '#0a0a0a',
    inkSoft: '#e4e4e4',
    button: '#0a0a0a',
    buttonInk: '#ffffff',
    footer: '#ffffff',
    footerInk: '#0a0a0a',
    footerSoft: '#e4e4e4',
    announce: '#0a0a0a',
    announceInk: '#8c8c8c',
    mark: '#ececec',
    markInk: '#333333',
    logoFont: 'sans',
  },
  {
    name: 'mint',
    paper: '#ffffff',
    surface: '#f0f7f4',
    tone: '#d5e9e2',
    tone2: '#a8d0c3',
    ink: '#12302a',
    inkSoft: '#d9e8e3',
    button: '#12302a',
    buttonInk: '#ffffff',
    footer: '#eaf4f0',
    footerInk: '#12302a',
    footerSoft: '#c8ddd5',
    announce: '#12302a',
    announceInk: '#7fa69a',
    mark: '#d5e9e2',
    markInk: '#2f5b50',
    logoFont: 'sans',
  },
];

/** FNV-1a 32-bit. Stable across runtimes (Workers, Node, browsers). */
export function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function toneFor(seed: string): StoreTone {
  return TONES[hash(seed.replace(/^www\./, '')) % TONES.length] as StoreTone;
}

/** Small seeded PRNG (mulberry32) for deterministic layout variation. */
export function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
