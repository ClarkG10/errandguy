import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Button } from './Button';
import type { LucideIcon } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

interface EmptyStateProps {
  /** Lucide icon — used when `illustration` is not provided. */
  icon?: LucideIcon;
  /** Optional bespoke illustration node (e.g. LocationIllustration).
   *  When supplied, replaces the soft circle + icon entirely. */
  illustration?: React.ReactNode;
  /** What is empty, specifically ("No notifications yet"). */
  title: string;
  /** Why it's empty, or what will fill it. */
  description?: string;
  /** The ONE next step — a full-width primary button. */
  actionLabel?: string;
  onAction?: () => void;
  /** An optional full-width outline button under the primary
   *  (e.g. "Learn more", "Skip for now"). */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  testID?: string;
}

/**
 * Pattern 1 (empty): a single line icon in a soft circle, a specific
 * headline, one or two lines saying why it's empty, then ONE primary next
 * step (full width) and at most one outline alternative.
 *
 * Used everywhere a list / collection has no items yet (no errands, no
 * notifications, no saved addresses, no chat history), so the app's
 * negative-space moments all read the same way.
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
  testID,
}: EmptyStateProps) {
  const reduceMotion = useReducedMotion();
  // Subtle settle-in (rule 20): 220ms fade + 8pt rise, skipped under
  // Reduce Motion so the content is simply there.
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    progress.value = reduceMotion ? 1 : withTiming(1, { duration: 220 });
  }, [progress, reduceMotion]);
  const enter = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));

  return (
    <View style={s.wrap} testID={testID}>
      <Animated.View style={[s.column, enter]}>
        {illustration ? (
          <View style={{ marginBottom: 4 }}>{illustration}</View>
        ) : Icon ? (
          <View style={s.circle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon size={40} color={LightColors.primary} strokeWidth={1.75} />
          </View>
        ) : null}
        <Text style={s.title} accessibilityRole="header">
          {title}
        </Text>
        {description ? <Text style={s.description}>{description}</Text> : null}
        {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
          <View style={s.actions}>
            {actionLabel && onAction ? (
              <Button title={actionLabel} onPress={onAction} variant="primary" size="lg" fullWidth />
            ) : null}
            {secondaryActionLabel && onSecondaryAction ? (
              <Button
                title={secondaryActionLabel}
                onPress={onSecondaryAction}
                // With no primary beside it, the one step IS the primary.
                variant={actionLabel && onAction ? 'outline' : 'primary'}
                size="lg"
                fullWidth
              />
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  column: { width: '100%', maxWidth: 360, alignItems: 'center' },
  circle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 20,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    textAlign: 'center',
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  description: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    maxWidth: 320,
  },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 24 },
});
