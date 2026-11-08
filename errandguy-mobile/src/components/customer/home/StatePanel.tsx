import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Button } from '../../ui/Button';
import { LightColors } from '../../../constants/colors';

interface StatePanelProps {
  /** One lucide line icon, drawn in primary inside a soft-tinted circle. */
  icon: LucideIcon;
  /** Specific headline: "No notifications yet", not "Nothing here". */
  title: string;
  /** Why it looks like this, in one or two plain lines. */
  description?: string;
  /** The ONE next step — a full-width primary button. */
  actionLabel?: string;
  onAction?: () => void;
  /** Optional alternative — a full-width outline button under it. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  testID?: string;
}

/**
 * The owner's reference look for a centred screen state (empty inbox, empty
 * ledger, no saved places…): a single line icon in a soft circle, a bold
 * specific headline, one or two lines of explanation, and ONE full-width
 * primary button (pattern 1), with an optional outline alternative.
 *
 * Lives with the customer screens rather than replacing the shared
 * `ui/EmptyState` (owned elsewhere); the two take the same ideas, and this one
 * can fold into it later.
 */
export function StatePanel({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  testID,
}: StatePanelProps) {
  return (
    <View style={s.wrap} testID={testID}>
      <View
        style={s.circle}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon size={40} color={LightColors.primary} strokeWidth={1.75} />
      </View>
      <Text style={s.title} accessibilityRole="header">
        {title}
      </Text>
      {description ? <Text style={s.body}>{description}</Text> : null}
      {(actionLabel && onAction) || (secondaryLabel && onSecondary) ? (
        <View style={s.actions}>
          {actionLabel && onAction ? (
            <Button title={actionLabel} onPress={onAction} fullWidth />
          ) : null}
          {secondaryLabel && onSecondary ? (
            <Button
              title={secondaryLabel}
              onPress={onSecondary}
              variant="outline"
              fullWidth
              style={actionLabel && onAction ? { marginTop: 12 } : undefined}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  circle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 24,
    fontSize: 20,
    lineHeight: 26,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
    textAlign: 'center',
  },
  body: {
    marginTop: 8,
    maxWidth: 320,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    marginTop: 28,
  },
});
