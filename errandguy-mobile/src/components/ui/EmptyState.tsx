import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
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
  /** Optional primary CTA rendered under the description. */
  actionLabel?: string;
  onAction?: () => void;
  /** Optional secondary text link rendered under the primary CTA
   *  (e.g. "Learn more", "Skip for now"). */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

/**
 * Modern empty state — calm layered disc.
 *
 * 2026 "clean & airy" pass: the gradient disc is retired (gradient
 * budget belongs to the two hero screens + FAB). Instead:
 *  - Outer soft halo (blue50, low opacity) gives perceived depth.
 *  - Inner soft-tinted disc with a brand-blue stroked icon.
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
  secondaryActionLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-12">
      {illustration ? (
        <View style={{ marginBottom: 4 }}>{illustration}</View>
      ) : Icon ? (
        // Outer halo — large, very soft. Pure cosmetic depth cue.
        <View style={styles.halo}>
          {/* Inner soft disc with a brand-blue icon — quiet, airy. */}
          <View style={styles.disc}>
            <Icon size={32} color={LightColors.primary} strokeWidth={1.9} />
          </View>
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
      {secondaryActionLabel && onSecondaryAction && (
        <Pressable
          onPress={onSecondaryAction}
          accessibilityRole="button"
          accessibilityLabel={secondaryActionLabel}
          hitSlop={8}
          style={styles.secondaryLink}
        >
          <Text style={styles.secondaryLinkText}>{secondaryActionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: `${LightColors.primary}14`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLink: {
    marginTop: 14,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  secondaryLinkText: {
    fontSize: 14,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.primary,
    letterSpacing: 0.1,
  },
});
