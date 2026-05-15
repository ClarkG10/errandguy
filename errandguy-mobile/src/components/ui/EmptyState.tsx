import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Button } from './Button';
import type { LucideIcon } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

interface EmptyStateProps {
  /** Lucide icon — used when `illustration` is not provided. */
  icon?: LucideIcon;
  /** Optional bespoke illustration node (e.g. LocationIllustration).
   *  When supplied, replaces the gradient disc + icon entirely. */
  illustration?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Modern empty state — premium illustration affordance.
 *
 * Replaces the previous flat tinted square with a layered, gradient
 * illustration disc:
 *  - Outer soft halo (blue50, low opacity) gives perceived depth.
 *  - Inner gradient disc carries the brand blues.
 *  - White stroked icon sits centred for crisp legibility.
 *
 * Used everywhere a list / collection has no items yet (no errands,
 * no notifications, no saved addresses, no chat history). Forms a
 * cohesive language across the app's negative-space moments.
 */
export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-12">
      {illustration ? (
        <View style={{ marginBottom: 4 }}>{illustration}</View>
      ) : Icon ? (
        // Outer halo — large, very soft. Pure cosmetic depth cue.
        <View style={styles.halo}>
          {/* Inner gradient disc carries the brand identity. */}
          <LinearGradient
            colors={[LightColors.gradientMid, LightColors.gradientStart]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.disc}
          >
            <Icon size={32} color="#FFFFFF" strokeWidth={1.9} />
          </LinearGradient>
        </View>
      ) : null}
      <Text className="text-lg font-montserrat-bold text-textPrimary mt-5 text-center">
        {title}
      </Text>
      {description && (
        <Text className="text-sm font-montserrat text-textSecondary mt-2 text-center max-w-[280px] leading-5">
          {description}
        </Text>
      )}
      {actionLabel && onAction && (
        <View className="mt-6">
          <Button
            title={actionLabel}
            onPress={onAction}
            variant="primary"
            size="md"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(37,99,235,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: LightColors.primary700,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
});
