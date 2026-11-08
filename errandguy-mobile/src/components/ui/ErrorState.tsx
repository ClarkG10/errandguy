import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { AlertTriangle, WifiOff, RefreshCw } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Button } from './Button';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { describeError } from '../../utils/errorCatalog';

/** Said when nothing more specific is known — it blames nobody. */
const NEUTRAL_DESCRIPTION = 'Please try again.';
const DEFAULT_TITLE = "Couldn't load this";

interface ErrorStateProps {
  /** Lucide icon. Defaults to WifiOff for a connection failure, otherwise
   *  AlertTriangle. */
  icon?: LucideIcon;
  /** Optional artwork above the error card. None by default — the tinted
   *  card carries the state. Ignored in compact mode. */
  illustration?: React.ReactNode | null;
  /** What went wrong. Defaults to the catalogued title for `error`
   *  ("You're offline", "Something went wrong on our end"…), else
   *  "Couldn't load this". */
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
  /** An outline button under Retry — a way out that doesn't depend on Retry
   *  ever working (e.g. "Go to Home"). Same as EmptyState's. Full layout only. */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Compact horizontal layout for embedding inside cards / list slots
   *  instead of taking over the whole screen. */
  compact?: boolean;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Pattern 3 (error) — the sibling of EmptyState.
 *
 * EmptyState says "there's nothing here (yet)"; ErrorState says "there
 * should be something here but we couldn't fetch it". It says what went
 * wrong (title), whose fault it is and how to fix it (the catalogued
 * description), then offers Retry as the one primary action and an outline
 * way out. A red-tinted card with a warning icon, so the two states are never
 * confused at a glance.
 *
 * Two layouts:
 *  - default  — the tinted card + full-width actions, centred, for
 *               whole-screen failures.
 *  - compact  — a tinted row (icon + copy + retry) for embedding inside a
 *               Card or a list section that partially loaded.
 */
export function ErrorState({
  icon,
  illustration = null,
  title: titleProp,
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
  const described = apiError ? describeError(apiError) : null;
  const title = titleProp ?? described?.title ?? DEFAULT_TITLE;
  const description = descriptionProp ?? described?.message ?? NEUTRAL_DESCRIPTION;
  const isConnection = apiError?.kind === 'offline';
  const Icon = icon ?? (isConnection ? WifiOff : AlertTriangle);

  if (compact) {
    return (
      <View style={[s.compactRow, style]} testID={testID}>
        <Icon size={20} color={LightColors.dangerDark} strokeWidth={2} style={s.compactIcon} />
        <View style={s.compactCopy}>
          <Text style={s.compactTitle}>{title}</Text>
          {description ? <Text style={s.compactDescription}>{description}</Text> : null}
        </View>
        {onRetry ? (
          <Button title={retryLabel} onPress={onRetry} variant="outline" size="sm" />
        ) : null}
      </View>
    );
  }

  return (
    <View style={[s.wrap, style]} testID={testID}>
      <View style={s.column}>
        {illustration ? <View style={s.illustration}>{illustration}</View> : null}
        <View style={s.card} accessibilityRole="alert">
          <View style={s.cardHead}>
            <Icon size={20} color={LightColors.dangerDark} strokeWidth={2} />
            <Text style={s.title} accessibilityRole="header">
              {title}
            </Text>
          </View>
          {description ? <Text style={s.description}>{description}</Text> : null}
        </View>
        {onRetry || (secondaryActionLabel && onSecondaryAction) ? (
          <View style={s.actions}>
            {onRetry ? (
              <Button title={retryLabel} onPress={onRetry} variant="primary" size="lg" fullWidth icon={RefreshCw} />
            ) : null}
            {secondaryActionLabel && onSecondaryAction ? (
              <Button
                title={secondaryActionLabel}
                onPress={onSecondaryAction}
                variant={onRetry ? 'outline' : 'primary'}
                size="lg"
                fullWidth
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// Error tint built from the danger token: ~6% wash, ~25% hairline.
const ERROR_WASH = `${LightColors.danger}0F`;
const ERROR_LINE = `${LightColors.danger}40`;

const s = StyleSheet.create({
  // ── Full layout ────────────────────────────────────────────
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  column: { width: '100%', maxWidth: 400, alignItems: 'stretch' },
  illustration: { alignItems: 'center', marginBottom: 16 },
  card: {
    backgroundColor: ERROR_WASH,
    borderColor: ERROR_LINE,
    borderWidth: 1,
    borderRadius: Radius.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.dangerDark,
    letterSpacing: -0.2,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textPrimary,
    marginTop: 6,
    // Under the title, past the icon (20) + gap (10).
    marginLeft: 30,
  },
  actions: { gap: 10, marginTop: 20 },

  // ── Compact layout ─────────────────────────────────────────
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: Radius.control,
    backgroundColor: ERROR_WASH,
    borderColor: ERROR_LINE,
    borderWidth: 1,
  },
  compactIcon: { marginRight: 10, alignSelf: 'flex-start', marginTop: 1 },
  compactCopy: {
    flex: 1,
    marginRight: 10,
  },
  compactTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.dangerDark,
  },
  compactDescription: {
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    lineHeight: 18,
    marginTop: 2,
  },
});
