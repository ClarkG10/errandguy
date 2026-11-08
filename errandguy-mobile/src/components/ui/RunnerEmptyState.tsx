import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Button } from './Button';
import { LightColors } from '../../constants/colors';

interface RunnerEmptyStateProps {
  icon?: LucideIcon;
  /** Optional illustration shown instead of the outlined glyph. */
  illustration?: React.ReactNode;
  title: string;
  description?: string;
  /** Tiny eyebrow above the title. Optional, and off by default — only pass
   *  one that adds context the title doesn't already say. */
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional outline button under the primary CTA. */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Extra content under the actions, e.g. suggestion chips after a search
   *  that found nothing. */
  children?: React.ReactNode;
}

/**
 * Empty state for the runner screens — pattern 1, in the same language as
 * EmptyState (the owner's reference): a single line icon in a soft circle (or
 * an illustration), a specific headline, a line on why it's empty, then ONE
 * full-width primary next step and at most one outline alternative.
 *
 * Kept as its own component for its runner-only extras: an optional eyebrow
 * and `children` (e.g. search suggestion chips under a no-results state).
 */
export function RunnerEmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  eyebrow,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  children,
}: RunnerEmptyStateProps) {
  const hasPrimary = !!(actionLabel && onAction);
  return (
    <View style={s.wrap}>
      {illustration ? (
        <View style={{ marginBottom: 12 }}>{illustration}</View>
      ) : Icon ? (
        <View style={s.glyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Icon size={36} color={LightColors.primary} strokeWidth={1.75} />
        </View>
      ) : null}

      {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
      <Text style={s.title} accessibilityRole="header">
        {title}
      </Text>
      {description ? <Text style={s.description}>{description}</Text> : null}

      {hasPrimary || (secondaryActionLabel && onSecondaryAction) ? (
        <View style={s.actions}>
          {hasPrimary ? (
            <Button title={actionLabel as string} onPress={onAction} variant="primary" size="lg" fullWidth />
          ) : null}
          {secondaryActionLabel && onSecondaryAction ? (
            <Button
              title={secondaryActionLabel}
              onPress={onSecondaryAction}
              variant={hasPrimary ? 'outline' : 'primary'}
              size="lg"
              fullWidth
            />
          ) : null}
        </View>
      ) : null}
      {children}
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
  glyph: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  eyebrow: {
    fontSize: 12,
    fontFamily: 'Quicksand_700Bold',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: LightColors.textSecondary,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  description: {
    marginTop: 8,
    fontSize: 15,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 320,
  },
  actions: { alignSelf: 'center', width: '100%', maxWidth: 360, gap: 10, marginTop: 24 },
});
