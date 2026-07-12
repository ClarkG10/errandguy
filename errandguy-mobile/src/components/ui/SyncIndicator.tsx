import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { RotateCw } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';

/**
 * Ambient background-sync caption. Renders one of three tiny states so a
 * stale-while-revalidate refresh (which is otherwise invisible) reads as
 * intentional rather than a frozen screen:
 *
 *   • syncing        → animated dots + "Syncing…"
 *   • settled        → "Updated just now" / "Updated 5m ago"
 *   • error-w/-cache → "Couldn't refresh · Tap to retry" (calls onRetry)
 *
 * Designed to sit quietly under a header — 11px, tertiary ink, pill-shaped,
 * NO elevation. It only appears on WARM loads (isStale never fires on a cold
 * no-cache load), so it never collides with a full-screen skeleton.
 *
 * Feed it straight from useQuery:
 *   <SyncIndicator syncing={q.isStale} updatedAt={q.updatedAt}
 *                  error={!!q.error} onRetry={q.refresh} />
 */
interface SyncIndicatorProps {
  /** True while a cached-but-stale query is revalidating. */
  syncing: boolean;
  /** ms timestamp of the held value (useQuery.updatedAt). */
  updatedAt: number | null;
  /** A refresh failed but cached data is still shown. */
  error?: boolean;
  /** Tapped in the error state. */
  onRetry?: () => void;
  /** Alignment of the pill within its row (default flex-start). */
  align?: 'flex-start' | 'center' | 'flex-end';
  style?: StyleProp<ViewStyle>;
}

function formatUpdated(ts: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'Updated just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `Updated ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Updated ${h}h ago`;
  const d = Math.floor(h / 24);
  return `Updated ${d}d ago`;
}

export function SyncIndicator({
  syncing,
  updatedAt,
  error = false,
  onRetry,
  align = 'flex-start',
  style,
}: SyncIndicatorProps) {
  // A single self-owned minute-ish tick so "Updated Xm ago" advances without
  // every screen re-implementing an interval. Only runs while settled.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    if (syncing || error || updatedAt == null) return;
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [syncing, error, updatedAt]);

  // Nothing meaningful to say yet (cold load handled by a skeleton elsewhere).
  if (!syncing && !error && updatedAt == null) return null;

  const containerStyle = [styles.row, { alignSelf: align }, style];

  if (error) {
    return (
      <Pressable
        onPress={onRetry}
        disabled={!onRetry}
        accessibilityRole="button"
        accessibilityLabel="Couldn't refresh. Tap to retry."
        style={containerStyle}
        hitSlop={8}
      >
        <RotateCw size={12} color={LightColors.dangerDark} strokeWidth={2.2} />
        <Text style={[styles.text, styles.errorText]}>Couldn't refresh · Tap to retry</Text>
      </Pressable>
    );
  }

  if (syncing) {
    // No loader — just the quiet caption. The word carries the state; an
    // animated dot next to an 11px tertiary label read as fussy.
    return (
      <View style={containerStyle} accessibilityRole="text" accessibilityLabel="Syncing">
        <Text style={styles.text}>Syncing…</Text>
      </View>
    );
  }

  const label = formatUpdated(updatedAt as number, nowMs);
  return (
    <View style={containerStyle} accessibilityRole="text" accessibilityLabel={label}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
  },
  text: {
    fontSize: 11,
    color: LightColors.textTertiary,
    fontFamily: 'Quicksand_500Medium',
    letterSpacing: 0.1,
  },
  errorText: {
    color: LightColors.dangerDark,
  },
});
