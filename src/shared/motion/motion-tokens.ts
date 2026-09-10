// App-wide motion scale -- one definition, reused by every Framer Motion
// variant in motion-variants.ts and mirrored as plain CSS custom properties
// in globals.css (--motion-fast/base/medium/slow) for the many interactions
// that are plain CSS transitions instead (hover/focus/press states don't
// need a JS animation library). Keep the two in sync if either changes.
export const motionDuration = {
  instant: 0.1,
  fast: 0.14, // hover, tooltip
  base: 0.18, // button press, dropdown
  medium: 0.22, // page transition, modal/drawer entrance
  slow: 0.28, // drawer/modal on the slower end, success transitions
  deliberate: 0.45,
} as const;

export const motionEase = {
  enter: [0.22, 1, 0.36, 1],
  exit: [0.4, 0, 1, 1],
  standard: [0.4, 0, 0.2, 1],
  // Matches CSS's --ease-ui -- the general-purpose "calm, not bouncy" curve
  // for hover/press/focus micro-interactions specifically (enter/exit above
  // stay reserved for larger enter/exit transitions like modals and drawers).
  ui: [0.2, 0.8, 0.2, 1],
} as const;
