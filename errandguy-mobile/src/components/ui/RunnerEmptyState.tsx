import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Button } from './Button';

interface RunnerEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Tiny eyebrow above the title — mirrors the work-board feel
   *  ("STATUS · WAITING FOR REQUESTS"). Optional. */
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Empty state tuned for the runner role.
 *
 * The customer side uses a soft gradient disc + bright illustration —
 * it sits inside a discovery / consumer journey ("you have no errands
 * yet, book one!"). The runner experience is fundamentally different:
 * a runner is at work, watching for jobs. So this variant uses a
 * monochrome, terminal-like layout — uppercase eyebrow, hairline
 * outlined glyph, no playful colour. Reads as a status indicator on
 * a job board, not as marketing copy.
 *
 * Layout differences vs. the customer EmptyState:
 *  - No filled gradient disc; outlined slate ring instead.
 *  - Uppercase brand-letterspaced eyebrow above the title.
 *  - Tighter vertical rhythm and left-aligned-ish copy width.
 *  - Cooler slate palette (no blue tint) so it doesn't compete with
 *    the brand-blue hero or the green online indicator above it.
 */
export function RunnerEmptyState({
  icon: Icon,
  title,
  description,
  eyebrow = 'Standing by',
  actionLabel,
  onAction,
}: RunnerEmptyStateProps) {
  return (
    <View style={s.wrap}>
      {Icon ? (
        <View style={s.glyph}>
          <Icon size={26} color="#64748B" strokeWidth={1.6} />
        </View>
      ) : null}

      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.title}>{title}</Text>
      {description ? <Text style={s.description}>{description}</Text> : null}

      {actionLabel && onAction ? (
        <View style={{ marginTop: 18 }}>
          <Button title={actionLabel} onPress={onAction} variant="secondary" size="md" />
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
    paddingHorizontal: 32,
    paddingVertical: 56,
  },
  glyph: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  eyebrow: {
    fontSize: 10.5,
    fontFamily: 'Quicksand_700Bold',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#64748B',
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Quicksand_700Bold',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  description: {
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
});
