/**
 * Theme preference: 'light' | 'dark' | 'system', stored in localStorage['theme'].
 *
 * The inline script in BaseLayout's <head> resolves the preference before first paint and sets
 * <html data-theme="light|dark" data-theme-pref="…" class="js">. This module keeps it in sync
 * afterwards: theme controls anywhere on the page (delegated, so no per-component script),
 * system changes while on 'system', other tabs, and the theme-color meta.
 *
 * Controls (markup contract; see ThemeToggle.astro and ThemeSwitch.astro):
 *   [data-theme-toggle]          button, flips the effective theme; aria-pressed = dark
 *   [data-theme-set="light|…"]   role="radio" inside role="radiogroup" [data-theme-switch]
 * Listen for `theme:change` on document ({ detail: { pref, theme } }) to react to changes.
 */
export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const KEY = 'theme';
const root = document.documentElement;
const media = matchMedia('(prefers-color-scheme: dark)');
const META_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#0a0a0b' };

const isPref = (v: unknown): v is ThemePref => v === 'light' || v === 'dark' || v === 'system';

export function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(KEY);
    if (isPref(stored)) return stored;
  } catch {
    /* storage blocked (private mode, sandbox): fall back to system */
  }
  return 'system';
}

function writePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* not persisted; the choice still applies to this page view */
  }
}

export const resolve = (pref: ThemePref): Theme =>
  pref === 'system' ? (media.matches ? 'dark' : 'light') : pref;

export const currentTheme = (): Theme => (root.dataset.theme === 'dark' ? 'dark' : 'light');

/** Reflect the current state on every control (ARIA + roving tabindex). */
function sync() {
  const pref = isPref(root.dataset.themePref) ? root.dataset.themePref : 'system';
  const dark = currentTheme() === 'dark';
  document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(dark));
  });
  document.querySelectorAll<HTMLElement>('[data-theme-set]').forEach((btn) => {
    const on = btn.dataset.themeSet === pref;
    btn.setAttribute('aria-checked', String(on));
    btn.tabIndex = on ? 0 : -1;
  });
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', META_COLOR[currentTheme()]);
}

function apply(pref: ThemePref) {
  const theme = resolve(pref);
  root.dataset.themePref = pref;
  if (root.dataset.theme !== theme) {
    // Swap every token in one frame without transitions, then hand motion back.
    root.classList.add('theme-switching');
    root.dataset.theme = theme;
    void getComputedStyle(root).opacity;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => root.classList.remove('theme-switching')),
    );
  }
  sync();
  document.dispatchEvent(new CustomEvent('theme:change', { detail: { pref, theme } }));
}

export function setPref(pref: ThemePref) {
  writePref(pref);
  apply(pref);
}

document.addEventListener('click', (event) => {
  const el = (event.target as Element | null)?.closest<HTMLElement>(
    '[data-theme-toggle], [data-theme-set]',
  );
  if (!el) return;
  if (el.hasAttribute('data-theme-toggle')) {
    setPref(currentTheme() === 'dark' ? 'light' : 'dark');
  } else if (isPref(el.dataset.themeSet)) {
    setPref(el.dataset.themeSet);
  }
});

// Radio-group keyboard model for the 3-way switch: arrows move and select.
document.addEventListener('keydown', (event) => {
  const el = (event.target as Element | null)?.closest<HTMLElement>('[data-theme-set]');
  const group = el?.closest<HTMLElement>('[data-theme-switch]');
  if (!el || !group) return;
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[data-theme-set]'));
  const next = radios[(radios.indexOf(el) + step + radios.length) % radios.length];
  if (next && isPref(next.dataset.themeSet)) {
    setPref(next.dataset.themeSet);
    next.focus();
  }
});

media.addEventListener('change', () => {
  if (readPref() === 'system') apply('system');
});
window.addEventListener('storage', (event) => {
  if (event.key === KEY) apply(readPref());
});

if (!isPref(root.dataset.themePref)) root.dataset.themePref = readPref();
sync();
