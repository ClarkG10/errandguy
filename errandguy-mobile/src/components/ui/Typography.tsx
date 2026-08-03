import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

// Single-line label chrome (eyebrows, inline action links) lives in tight
// slots — a section-header edge, a pill, a stat label. At large
// accessibility text sizes an uncapped label overflows or shoves the
// layout; cap Dynamic Type at 1.3× so it still enlarges for legibility
// without breaking the row. Headings/body/data (SectionHeader title,
// subtitle, Stat value, KeyValueRow) are deliberately NOT capped — that
// is real content and should scale freely.
const CHROME_MAX_FONT_SCALE = 1.3;

/**
 * Typography primitives for the modernized design language.
 *
 * Why these exist:
 *   The previous UI leaned heavily on rounded card containers + colored
 *   tile-icons + filled buttons. That style scans as "generic SaaS app"
 *   and produces visual clutter when stacked. The pieces here are the
 *   opposite — they are typographic ONLY (no background fills, no
 *   borders, no rounded boxes) so screens compose primarily through
 *   hierarchy of TEXT, not through nested card stacks.
 *
 * Naming convention:
 *   - `Eyebrow`        — small uppercase label that lives ABOVE a title.
 *   - `SectionHeader`  — replaces the typical "Card title" pattern; pairs
 *                        an eyebrow with a heading and an optional inline
 *                        action link on the right edge.
 *   - `Hairline`       — 1px divider; replaces card borders for grouping.
 *   - `Stat`           — vertical "label + big value" pair used for
 *                        earnings, balances, distances. Asymmetric by
 *                        default (label sits left-aligned, value below).
 *   - `KeyValueRow`    — definition-list style row; left label, right
 *                        value, no card chrome.
 *   - `LinkButton`     — text-only inline action (NOT a CTA button) for
 *                        secondary affordances like "View all", "Edit",
 *                        "Report an issue".
 */

interface EyebrowProps {
  children: React.ReactNode;
  color?: string;
  className?: string;
}

export function Eyebrow({ children, color = LightColors.textSecondary, className = '' }: EyebrowProps) {
  return (
    <Text
      className={`text-[10px] font-montserrat-bold uppercase ${className}`}
      style={{ color, letterSpacing: 1.4 }}
      numberOfLines={1}
      maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
    >
      {children}
    </Text>
  );
}

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Right-edge inline action — text + optional icon. Renders as a link. */
  action?: { label: string; onPress: () => void; icon?: LucideIcon };
  /** Tone applied to the eyebrow + action link. Defaults to neutral. */
  tone?: 'neutral' | 'brand' | 'success' | 'danger' | 'warning';
}

const TONE: Record<NonNullable<SectionHeaderProps['tone']>, string> = {
  neutral: LightColors.textTertiary,
  brand: LightColors.primary,
  success: LightColors.success,
  danger: LightColors.danger,
  warning: LightColors.warning,
};

export function SectionHeader({ eyebrow, title, subtitle, action, tone = 'neutral' }: SectionHeaderProps) {
  const accent = TONE[tone];
  return (
    <View className="flex-row items-end justify-between mb-3">
      <View className="flex-1 pr-3">
        {eyebrow ? <Eyebrow color={accent}>{eyebrow}</Eyebrow> : null}
        <Text className="text-lg font-montserrat-bold text-textPrimary mt-0.5">
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="link"
          accessibilityLabel={action.label}
          hitSlop={8}
          className="flex-row items-center gap-1"
        >
          <Text
            className="text-[12px] font-montserrat-bold"
            style={{ color: accent }}
            numberOfLines={1}
            maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
          >
            {action.label}
          </Text>
          {action.icon ? <action.icon size={12} color={accent} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * 1px hairline. Use this between sections instead of wrapping each
 * section in its own Card. Reads as quieter visual separation and
 * leaves more horizontal space for content.
 */
export function Hairline({ className = '' }: { className?: string }) {
  return <View className={`h-px bg-divider ${className}`} />;
}

interface StatProps {
  label: string;
  value: React.ReactNode;
  /** Subtle helper text under the value (e.g. "vs last week"). */
  caption?: string;
  /** Tints the value text; defaults to textPrimary. */
  tone?: 'default' | 'brand' | 'success' | 'danger';
  /** Allow the value to wrap onto two lines. Default false. */
  wrap?: boolean;
  size?: 'md' | 'lg' | 'xl';
}

const STAT_TONE: Record<NonNullable<StatProps['tone']>, string> = {
  default: LightColors.textPrimary,
  brand: LightColors.primary,
  success: LightColors.success,
  danger: LightColors.danger,
};

const STAT_SIZE: Record<NonNullable<StatProps['size']>, string> = {
  md: 'text-xl',
  lg: 'text-[26px]',
  xl: 'text-[34px]',
};

export function Stat({ label, value, caption, tone = 'default', wrap = false, size = 'lg' }: StatProps) {
  return (
    <View className="flex-shrink">
      <Eyebrow>{label}</Eyebrow>
      <Text
        className={`${STAT_SIZE[size]} font-inter-semi mt-1`}
        style={{ color: STAT_TONE[tone], lineHeight: size === 'xl' ? 36 : size === 'lg' ? 28 : 22 }}
        numberOfLines={wrap ? 2 : 1}
      >
        {value}
      </Text>
      {caption ? (
        <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

interface KeyValueRowProps {
  label: string;
  value: React.ReactNode;
  /** Render value with brand tint (used for emphasis lines like total). */
  emphasis?: boolean;
  /** Use Inter (numeric) font for the value. Default true. */
  numeric?: boolean;
}

export function KeyValueRow({ label, value, emphasis = false, numeric = true }: KeyValueRowProps) {
  return (
    <View className="flex-row items-baseline justify-between py-1.5">
      <Text
        className={`text-[13px] font-montserrat ${emphasis ? 'text-textPrimary font-montserrat-bold' : 'text-textSecondary'}`}
      >
        {label}
      </Text>
      <Text
        className={`text-[14px] ${numeric ? 'font-inter-semi' : 'font-montserrat-semi'} ${emphasis ? 'text-primary' : 'text-textPrimary'}`}
      >
        {value}
      </Text>
    </View>
  );
}

interface LinkButtonProps {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  iconPosition?: 'leading' | 'trailing';
  tone?: 'brand' | 'neutral' | 'danger';
  disabled?: boolean;
}

const LINK_TONE: Record<NonNullable<LinkButtonProps['tone']>, string> = {
  brand: LightColors.primary,
  neutral: LightColors.textTertiary,
  danger: LightColors.danger,
};

export function LinkButton({
  label,
  onPress,
  icon: Icon,
  iconPosition = 'trailing',
  tone = 'brand',
  disabled,
}: LinkButtonProps) {
  const color = disabled ? LightColors.dividerStrong : LINK_TONE[tone];
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={8}
      className="flex-row items-center gap-1.5 self-start"
    >
      {Icon && iconPosition === 'leading' ? <Icon size={13} color={color} /> : null}
      <Text
        className="text-[12px] font-montserrat-bold underline"
        style={{ color }}
        numberOfLines={1}
        maxFontSizeMultiplier={CHROME_MAX_FONT_SCALE}
      >
        {label}
      </Text>
      {Icon && iconPosition === 'trailing' ? <Icon size={13} color={color} /> : null}
    </Pressable>
  );
}
