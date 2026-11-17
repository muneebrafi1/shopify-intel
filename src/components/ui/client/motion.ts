/**
 * Shared, optional motion. Everything here is a no-op under prefers-reduced-motion (the CSS
 * durations collapse to 0 and .reveal never hides anything), and content never depends on it.
 *
 *  - `.reveal`     fades + rises 8px once when it enters the viewport (home and Pro only).
 *                  Stagger siblings with style="--reveal-delay: 80ms".
 *  - `.spotlight`  a soft radial highlight follows the cursor (home feature cards only).
 */
const root = document.documentElement;
// Tells the <head> fallback timer that reveals are handled (otherwise it un-hides them).
root.dataset.motion = 'on';

const reveals = document.querySelectorAll<HTMLElement>('.reveal');
if (reveals.length) {
  if (!('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px' },
    );
    reveals.forEach((el) => io.observe(el));
  }
}

if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  let frame = 0;
  let target: HTMLElement | null = null;
  let x = 0;
  let y = 0;
  document.addEventListener(
    'pointermove',
    (event) => {
      target = (event.target as Element | null)?.closest?.<HTMLElement>('.spotlight') ?? null;
      if (!target) return;
      x = event.clientX;
      y = event.clientY;
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (!target) return;
        const r = target.getBoundingClientRect();
        target.style.setProperty('--mx', `${Math.round(x - r.left)}px`);
        target.style.setProperty('--my', `${Math.round(y - r.top)}px`);
      });
    },
    { passive: true },
  );
}
