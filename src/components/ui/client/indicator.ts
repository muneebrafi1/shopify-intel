/**
 * Sliding indicator for Tabs and Segmented (and anything with the same contract):
 *
 *   <div data-indicator> …items… </div>
 *
 * The selected direct child is the one with aria-current (not "false"), aria-pressed="true",
 * aria-checked="true" or aria-selected="true". We publish its box as --ind-x / --ind-w on the
 * container and set [data-indicator-ready]; the component CSS then draws one indicator that
 * slides. Before this runs (or without JS) each component shows a static selected style.
 * Changes to those ARIA attributes (pages switch them in place) move the indicator.
 */
const SELECTED = [
  '[aria-current]:not([aria-current="false"])',
  '[aria-pressed="true"]',
  '[aria-checked="true"]',
  '[aria-selected="true"]',
]
  .map((s) => `:scope > ${s}`)
  .join(', ');

function setup(track: HTMLElement) {
  if (track.hasAttribute('data-indicator-ready')) return;
  const place = () => {
    const active = track.querySelector<HTMLElement>(SELECTED);
    if (!active || active.offsetWidth === 0) {
      track.style.setProperty('--ind-o', '0');
      return;
    }
    track.style.setProperty('--ind-x', `${active.offsetLeft}px`);
    track.style.setProperty('--ind-w', `${active.offsetWidth}px`);
    track.style.setProperty('--ind-o', '1');
  };
  place();
  track.setAttribute('data-indicator-ready', '');
  // Only animate changes after the first placement.
  requestAnimationFrame(() => track.classList.add('is-sliding'));
  new MutationObserver(place).observe(track, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-current', 'aria-pressed', 'aria-checked', 'aria-selected'],
  });
  if ('ResizeObserver' in window) new ResizeObserver(place).observe(track);
  document.fonts?.ready.then(place);
}

export function initIndicators(scope: ParentNode = document) {
  scope.querySelectorAll<HTMLElement>('[data-indicator]').forEach(setup);
}

initIndicators();
