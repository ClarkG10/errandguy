import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { CloudOff, RefreshCw } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Button } from './Button';
import { LightColors } from '../../constants/colors';

interface ErrorStateProps {
  /** Lucide icon. Defaults to CloudOff (most load failures are connectivity). */
  icon?: LucideIcon;
  title?: string;
  description?: string;
  /** When provided, renders a Retry button that invokes this callback. */
  onRetry?: () => void;
  /** Label for the retry button. Defaults to "Retry". */
  retryLabel?: string;
  /** Compact horizontal layout for embedding inside cards / list slots
   *  instead of taking over the whole screen. */
  compact?: boolean;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Inline error block for failed loads — the sibling of EmptyState.
 *
 * EmptyState says "there's nothing here (yet)"; ErrorState says "there
 * should be something here but we couldn't fetch it". Uses the same
 * halo + disc language as EmptyState but tinted with the danger ramp so
 * the two states are never confused at a glance.
 *
 * Two layouts:
 *  - default  — full-flex centered block for whole-screen failures.
 *  - compact  — one-line row (icon chip + copy + retry) for embedding
 *               inside a Card or a list section that partially loaded.
 */
export function ErrorState({
  icon: Icon = CloudOff,
  title = "Couldn't load this",
  description = 'Check your internet connection and try again.',
  onRetry,
  retryLabel = 'Retry',
  compact = false,
  style,
  testID,
}: ErrorStateProps) {
  if (compact) {
    return (
      <View style={[s.compactRow, style]} testID={testID}>
        <View style={s.compactChip}>
          <Icon size={18} color={LightColors.danger} strokeWidth={1.9} />
        </View>
        <View style={s.compactCopy}>
          <Text style={s.compactTitle} numberOfLines={1}>
            {title}
          </Text>
          {description ? (
            <Text style={s.compactDescription} numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        {onRetry ? (
          <Button
            title={retryLabel}
            onPress={onRetry}
            variant="secondary"
            size="sm"
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={[s.wrap, style]} testID={testID}>
      {/* Outer halo — same depth cue as EmptyState, danger-tinted. */}
      <View style={s.halo}>
        <View style={s.disc}>
          <Icon size={30} color={LightColors.danger} strokeWidth={1.9} />
        </View>
      </View>
      <Text style={s.title}>{title}</Text>
      {description ? <Text style={s.description}>{description}</Text> : null}
      {onRetry ? (
        <View style={{ marginTop: 20 }}>
          <Button
            title={retryLabel}
            onPress={onRetry}
            variant="secondary"
            size="md"
            icon={RefreshCw}
          />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // ── Full layout ────────────────────────────────────────────
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  halo: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: `${LightColors.danger}0F`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: LightColors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
    textAlign: 'center',
    marginTop: 18,
    letterSpacing: -0.2,
  },
  description: {
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
    marginTop: 6,
  },

  // ── Compact layout ─────────────────────────────────────────
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  compactChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: LightColors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  compactCopy: {
    flex: 1,
    marginRight: 12,
  },
  compactTitle: {
    fontSize: 14,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
    letterSpacing: -0.1,
  },
  compactDescription: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textTertiary,
    lineHeight: 16,
    marginTop: 2,
  },
});
