import React from 'react';
import { View, Text, Pressable, StatusBar, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

/**
 * Page header used on every customer (and runner) page.
 *
 * 2026 "clean & airy" pass: the default is now a flat `soft` variant —
 * background-colored band, ink title, circular muted back button — so
 * the brand gradient stops shouting from every screen. The gradient
 * budget is two hero moments (customer home, auth welcome) plus the
 * QuickBook FAB; pages that truly need the brand band can opt back in
 * with `variant="brand"`.
 *
 * The wrapping `View` adds a default 16px bottom margin so screen
 * content below the header always has visible breathing room —
 * without each consumer having to remember to add `mt-4` themselves.
 */
interface TrailingAction {
  icon?: LucideIcon;
  label?: string;
  onPress: () => void;
  badge?: number;
  accessibilityLabel?: string;
}

interface GradientHeaderProps {
  title: string;
  showBack?: boolean;
  fallbackHref?: string;
  trailing?: TrailingAction | React.ReactNode;
  /** Extra content rendered under the title row, still on the band. */
  children?: React.ReactNode;
  /** Round the bottom corners. Off by default — only the brand hero uses it. */
  rounded?: boolean;
  /** Drop the default 16px bottom margin (e.g. when the next element is
   *  meant to overlap the header, like a search pill). */
  flush?: boolean;
  /** `soft` (default): flat background band, ink text, muted circular
   *  back button. `brand`: legacy blue gradient band — reserved for
   *  hero moments. */
  variant?: 'soft' | 'brand';
}

export const HEADER_COLORS = [
  LightColors.gradientStart,
  LightColors.gradientMid,
  LightColors.gradientEnd,
] as const;

// Muted circle behind the back chevron on the soft variant — one step
// deeper than the canvas so it reads as a control.
const SOFT_BACK_BG = LightColors.divider;

export function GradientHeader({
  title,
  showBack = false,
  fallbackHref,
  trailing,
  children,
  rounded = false,
  flush = false,
  variant = 'soft',
}: GradientHeaderProps) {
  const router = useRouter();
  const { mScale } = useResponsive();

  const soft = variant === 'soft';

  // Header chrome scales moderately so it stays balanced on narrow
  // phones (~10% smaller) without growing oversized on tablets
  // (~10% larger). Title row height keeps the platform-specific
  // delta because Material vs Human-Interface guidelines disagree.
  const padH = mScale(20);
  const titleHeight = mScale(Platform.OS === 'android' ? 48 : 52);
  const titleFont = mScale(Platform.OS === 'android' ? 17 : 19);
  const trailingSlot = mScale(40);
  const backBtn = mScale(36);
  const trailingIcon = mScale(22);
  const backIcon = mScale(20);

  const contentColor = soft ? LightColors.ink : LightColors.textInverse;

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else if (fallbackHref) router.replace(fallbackHref as any);
  };

  const slotStyle = { minWidth: trailingSlot, height: trailingSlot } as const;

  const renderTrailing = () => {
    if (!trailing) return <View style={[s.trailingSlot, slotStyle]} />;
    if (React.isValidElement(trailing)) {
      return <View style={[s.trailingSlot, slotStyle]}>{trailing}</View>;
    }
    const t = trailing as TrailingAction;
    if (t.icon) {
      const Icon = t.icon;
      return (
        <Pressable
          onPress={t.onPress}
          hitSlop={10}
          style={[s.trailingSlot, slotStyle, { marginRight: -6 }]}
          accessibilityRole="button"
          accessibilityLabel={t.accessibilityLabel ?? t.label ?? 'Action'}
        >
          <Icon size={trailingIcon} color={contentColor} strokeWidth={1.9} />
          {t.badge && t.badge > 0 ? (
            <View
              className="absolute"
              style={{
                top: 6,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: LightColors.danger,
                borderWidth: 1.5,
                borderColor: soft ? LightColors.background : LightColors.primaryDark,
              }}
            />
          ) : null}
        </Pressable>
      );
    }
    if (t.label) {
      return (
        <Pressable
          onPress={t.onPress}
          hitSlop={10}
          style={[s.trailingSlot, slotStyle]}
          accessibilityRole="button"
          accessibilityLabel={t.accessibilityLabel ?? t.label}
        >
          <Text
            className="text-[12px] font-montserrat-bold"
            style={{ color: soft ? LightColors.primary : LightColors.textInverse }}
          >
            {t.label}
          </Text>
        </Pressable>
      );
    }
    return <View style={[s.trailingSlot, slotStyle]} />;
  };

  const inner = (
    <SafeAreaView edges={['top']}>
      {/* Fixed-height title row — keeps every page header the same
          vertical size regardless of whether trailing is an icon
          button (40px tall), a label (~14px), or absent. */}
      <View style={[s.titleRow, { paddingHorizontal: padH, height: titleHeight }]}>
        {showBack ? (
          <Pressable
            onPress={handleBack}
            hitSlop={10}
            style={[
              s.backBtn,
              {
                width: backBtn,
                height: backBtn,
                borderRadius: backBtn / 2,
                backgroundColor: soft ? SOFT_BACK_BG : `${LightColors.textInverse}2E`,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={backIcon} color={contentColor} strokeWidth={2.2} />
          </Pressable>
        ) : null}
        <Text
          className="flex-1 font-montserrat-bold"
          numberOfLines={1}
          style={{
            marginLeft: showBack ? 10 : 0,
            fontSize: titleFont,
            color: contentColor,
          }}
        >
          {title}
        </Text>
        {renderTrailing()}
      </View>
      {/* Children render under the title row with a small bottom
          gutter so the band has weight even on slim headers. */}
      {children ? <View style={{ paddingBottom: 8 }}>{children}</View> : null}
    </SafeAreaView>
  );

  if (soft) {
    return (
      <>
        {Platform.OS === 'ios' && <StatusBar barStyle="dark-content" />}
        <View
          style={[
            { backgroundColor: LightColors.background },
            rounded ? s.gradientRounded : undefined,
            !flush && { marginBottom: 16 },
          ]}
        >
          {inner}
        </View>
      </>
    );
  }

  return (
    <>
      {Platform.OS === 'ios' && <StatusBar barStyle="light-content" />}
      <LinearGradient
        colors={HEADER_COLORS as readonly [string, string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          rounded ? s.gradientRounded : undefined,
          !flush && { marginBottom: 16 },
        ]}
      >
        {inner}
      </LinearGradient>
    </>
  );
}

const s = StyleSheet.create({
  gradientRounded: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trailingSlot: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  backBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
