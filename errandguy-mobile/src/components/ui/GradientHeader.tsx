import React from 'react';
import { View, Text, Pressable, StatusBar, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';

/**
 * Brand-color page header — used on every customer (and runner) page
 * for visual consistency. Slim by default; pages that need a hero
 * (home, auth) wrap their own LinearGradient with extra body content.
 *
 * Pattern: blue gradient band with rounded bottom corners, white
 * title left, optional trailing action right, optional back chevron.
 *
 * The wrapping `View` adds a default 16px bottom margin so screen
 * content below the header always has visible breathing room from
 * the brand band — without each consumer having to remember to add
 * `mt-4` themselves.
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
  /** Extra content rendered under the title row, still on the gradient. */
  children?: React.ReactNode;
  /** Round the bottom corners. Off by default — only the home hero uses it. */
  rounded?: boolean;
  /** Drop the default 16px bottom margin (e.g. when the next element is
   *  meant to overlap the header, like a search pill). */
  flush?: boolean;
}

export const HEADER_COLORS = ['#1D4ED8', '#2563EB', '#3B82F6'] as const;

export function GradientHeader({
  title,
  showBack = false,
  fallbackHref,
  trailing,
  children,
  rounded = false,
  flush = false,
}: GradientHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else if (fallbackHref) router.replace(fallbackHref as any);
  };

  const renderTrailing = () => {
    if (!trailing) return <View style={s.trailingSlot} />;
    if (React.isValidElement(trailing)) {
      return <View style={s.trailingSlot}>{trailing}</View>;
    }
    const t = trailing as TrailingAction;
    if (t.icon) {
      const Icon = t.icon;
      return (
        <Pressable
          onPress={t.onPress}
          hitSlop={10}
          style={[s.trailingSlot, { marginRight: -6 }]}
          accessibilityRole="button"
          accessibilityLabel={t.accessibilityLabel ?? t.label ?? 'Action'}
        >
          <Icon size={22} color="#FFFFFF" strokeWidth={1.9} />
          {t.badge && t.badge > 0 ? (
            <View
              className="absolute"
              style={{
                top: 6,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: '#F87171',
                borderWidth: 1.5,
                borderColor: '#1D4ED8',
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
          style={s.trailingSlot}
          accessibilityRole="button"
          accessibilityLabel={t.accessibilityLabel ?? t.label}
        >
          <Text className="text-[12px] font-montserrat-bold text-white">
            {t.label}
          </Text>
        </Pressable>
      );
    }
    return <View style={s.trailingSlot} />;
  };

  return (
    <>
      {Platform.OS === 'ios' && <StatusBar barStyle="light-content" />}
      <LinearGradient
        colors={HEADER_COLORS as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          rounded ? s.gradientRounded : undefined,
          !flush && { marginBottom: 16 },
        ]}
      >
        <SafeAreaView edges={['top']}>
          {/* Fixed-height title row — keeps every page header the same
              vertical size regardless of whether trailing is an icon
              button (40px tall), a label (~14px), or absent. */}
          <View style={s.titleRow}>
            {showBack ? (
              <Pressable
                onPress={handleBack}
                hitSlop={10}
                style={s.backBtn}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <ChevronLeft size={20} color="#FFFFFF" strokeWidth={2.2} />
              </Pressable>
            ) : null}
            <Text
              className="flex-1 font-montserrat-bold text-white"
              numberOfLines={1}
              style={{
                marginLeft: showBack ? 8 : 0,
                fontSize: Platform.OS === 'android' ? 16 : 18,
              }}
            >
              {title}
            </Text>
            {renderTrailing()}
          </View>
          {/* Children render under the title row with a small bottom
              gutter so the brand band has weight even on slim headers. */}
          {children ? <View style={{ paddingBottom: 8 }}>{children}</View> : null}
        </SafeAreaView>
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
    paddingHorizontal: 20,
    height: Platform.OS === 'android' ? 48 : 52,
  },
  trailingSlot: {
    minWidth: 40,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
