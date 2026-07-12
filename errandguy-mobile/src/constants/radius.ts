/**
 * ErrandGuy corner-radius tokens — "Modern soft" (July 2026).
 *
 * The 2026-airy pass had leaned on full pills (999) for CTAs and very
 * large corners (24–36) everywhere, which read heavy on real devices.
 * This scale pulls every rectangular surface down to a subtler, more
 * contemporary radius while keeping *true* circles (avatars, icon
 * buttons, count badges) fully round via `pill`.
 *
 * Use these numeric tokens for StyleSheet / inline `borderRadius`.
 * The matching NativeWind `rounded-*` scale lives in tailwind.config.js
 * and mirrors these values so `className` and `style` stay in sync.
 *
 * Rule of thumb:
 *   • chip     — filter chips, small pills, segmented toggles
 *   • control  — inputs, small/secondary buttons, list rows
 *   • button   — the primary CTA corner (was a 999 pill)
 *   • card     — standard content cards
 *   • sheet    — bottom sheets & full modals (top corners)
 *   • pill     — ONLY circles / avatars / dot badges that must stay round
 */
export const Radius = {
  xs: 6,
  chip: 10,
  control: 12,
  button: 14,
  card: 16,
  sheet: 20,
  modal: 20,
  /** Fully round — avatars, icon circles, count badges, true pills. */
  pill: 9999,
} as const;

export type RadiusToken = keyof typeof Radius;
