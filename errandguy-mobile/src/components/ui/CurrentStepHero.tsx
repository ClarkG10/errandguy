import React from 'react';
import { View, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

/**
 * CurrentStepHero — the deliberately UN-card-shaped "what's happening
 * right now" headline for tracking screens.
 *
 * Design intent (not a typical AI/template card):
 *  • No bordered card, no rounded background, no icon-in-a-tile.
 *  • Big typographic verb-led headline that fills the row, in the
 *    booking's brand color.
 *  • A small caption above (eyebrow) carrying the human-friendly
 *    "Step 3 of 6" affordance — anchors the eye without a stepper widget.
 *  • Right-aligned ETA chip (pill) only when we have one. The chip is
 *    the ONE allowable rounded element so it reads as data, not a CTA.
 *  • Optional thin icon to the left of the eyebrow. Stroke-only (no
 *    filled tile) so it harmonizes with the typography.
 *
 * Used by both customer tracking and runner errand screens so the two
 * sides of the trip share a consistent visual language while showing
 * the role-specific message.
 */

interface CurrentStepHeroProps {
  /** Eyebrow above the title — e.g. "STEP 3 OF 6" or "RIGHT NOW". */
  eyebrow?: string;
  /** Main verb-led message — e.g. "Picking up your order". */
  title: string;
  /** One-line subtext — e.g. "Maria is at Jollibee BGC.". Optional. */
  subtitle?: string;
  /** Minutes-until label, rendered as the right-edge pill. */
  etaMinutes?: number | null;
  /** Custom right-edge label (e.g. "Arrived"). Wins over etaMinutes. */
  etaLabel?: string;
  /** Brand vs alert tint. Defaults to brand blue. */
  accent?: 'brand' | 'danger' | 'success' | 'warning';
  /** Optional Lucide stroke icon shown to the left of the eyebrow. */
  Icon?: LucideIcon;
}

const ACCENT: Record<NonNullable<CurrentStepHeroProps['accent']>, { color: string; pillBg: string }> = {
  brand: { color: '#2563EB', pillBg: 'rgba(37, 99, 235, 0.10)' },
  danger: { color: '#EF4444', pillBg: 'rgba(239, 68, 68, 0.10)' },
  success: { color: '#16A34A', pillBg: 'rgba(22, 163, 74, 0.10)' },
  warning: { color: '#D97706', pillBg: 'rgba(217, 119, 6, 0.10)' },
};

export function CurrentStepHero({
  eyebrow,
  title,
  subtitle,
  etaMinutes,
  etaLabel,
  accent = 'brand',
  Icon,
}: CurrentStepHeroProps) {
  const { color, pillBg } = ACCENT[accent];

  return (
    <View className="flex-row items-start">
      <View className="flex-1 pr-3">
        {(eyebrow || Icon) && (
          <View className="flex-row items-center mb-1">
            {Icon ? <Icon size={12} color={color} strokeWidth={2.4} /> : null}
            {eyebrow ? (
              <Text
                className="text-[10px] font-montserrat-bold uppercase ml-1.5"
                style={{ color, letterSpacing: 1.4 }}
              >
                {eyebrow}
              </Text>
            ) : null}
          </View>
        )}
        {/* Title — large, leading-tight. We deliberately use leading-6
            on a 22px text so multi-line titles (e.g. "Heading to your
            drop-off") feel composed rather than airy. */}
        <Text
          className="text-[22px] font-montserrat-bold text-textPrimary"
          style={{ lineHeight: 26 }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs font-montserrat text-textSecondary mt-1">
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/* Right-edge ETA pill — only thing rounded so it reads as a
          numeric badge, not a button. */}
      {(etaLabel || etaMinutes != null) && (
        <View
          className="rounded-full px-3 py-1.5 items-center justify-center"
          style={{ backgroundColor: pillBg, minWidth: 60 }}
        >
          {etaLabel ? (
            <Text
              className="text-[12px] font-montserrat-bold"
              style={{ color }}
            >
              {etaLabel}
            </Text>
          ) : (
            <>
              <Text
                className="text-[16px] font-montserrat-bold leading-4"
                style={{ color }}
              >
                {etaMinutes}
              </Text>
              <Text
                className="text-[9px] font-montserrat-semi mt-0.5"
                style={{ color, opacity: 0.75 }}
              >
                MIN
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}
