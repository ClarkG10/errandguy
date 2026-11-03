import React from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { AlertCircle, CloudOff, RefreshCw } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Button } from './Button';
import { Illustration } from './Illustration';
import { LightColors } from '../../constants/colors';
import { describeError } from '../../utils/errorCatalog';

/** Said when nothing more specific is known — it blames nobody. */
const NEUTRAL_DESCRIPTION = 'Please try again.';

interface ErrorStateProps {
  /** Lucide icon. Defaults to CloudOff, or AlertCircle when `error` shows
   *  the failure wasn't the connection. */
  icon?: LucideIcon;
  /** Full-layout illustration. Defaults to the error-generic artwork;
   *  pass null to fall back to the halo + icon. Ignored in compact mode. */
  illustration?: React.ReactNode | null;
  title?: string;
  /** Explicit copy. Wins over `error`. */
  description?: string;
  /**
   * The load failure (e.g. a useQuery `error`). Its catalogued message
   * (utils/errorCatalog) becomes the description, so "check your connection"
   * is only said when it really was the connection.
   */
  error?: unknown;
  /** When provided, renders a Retry button that invokes this callback. */
  onRetry?: () => void;
  /** Label for the retry button. Defaults to "Retry". */
  retryLabel?: string;
  /** A quiet link under Retry — a way out that doesn't depend on Retry ever
   *  working (e.g. "Go to Home"). Same as EmptyState's. Full layout only. */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
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
  icon,
  illustration = <Illustration name="error-generic" size={168} />,
  title = "Couldn't load this",
  description: descriptionProp,
  error,
  onRetry,
  retryLabel = 'Retry',
  secondaryActionLabel,
  onSecondaryAction,
  compact = false,
  style,
  testID,
}: ErrorStateProps) {
  // The default used to read "Check your internet connection" for EVERY
  // failure — a 500, a 404 and a refused request included — so people on a
  // perfectly good connection were told to fix it. Only an api-layer error
  // (it carries `kind`/`status`) is catalogued; a raw JS exception's message
  // is developer text, never shown.
  const apiError =
    error != null && typeof error === 'object' && ('kind' in error || 'status' in error)
      ? (error as { kind?: string })
      : null;
  const description =
    descriptionProp ?? (apiError ? describeError(apiError).message : NEUTRAL_DESCRIPTION);
  const Icon =
    icon ??
    (apiError && apiError.kind !== 'offline' && apiError.kind !== 'timeout'
      ? AlertCircle
      : CloudOff);

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
      {illustration ? (
        <View style={{ marginBottom: 2 }}>{illustration}</View>
      ) : (
        // Fallback: halo + icon when illustration is explicitly nulled.
        <View style={s.halo}>
          <View style={s.disc}>
            <Icon size={30} color={LightColors.danger} strokeWidth={1.9} />
          </View>
        </View>
      )}
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
      {secondaryActionLabel && onSecondaryAction ? (
        <Pressable
          onPress={onSecondaryAction}
          accessibilityRole="button"
          accessibilityLabel={secondaryActionLabel}
          hitSlop={8}
          style={s.secondaryLink}
        >
          <Text style={s.secondaryLinkText}>{secondaryActionLabel}</Text>
        </Pressable>
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
