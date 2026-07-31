import React from 'react';
import { View, Pressable } from 'react-native';
import { Star } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { LightColors } from '../../constants/colors';

interface RatingStarsProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readonly?: boolean;
}

export function RatingStars({
  value,
  onChange,
  size = 24,
  readonly = false,
}: RatingStarsProps) {
  const interactive = !readonly && !!onChange;
  // Pad each star's touch target out to >=44pt regardless of the glyph
  // size (read-only 13px stars in cards, 36px pickers on the rate screen).
  const slop = Math.max(0, Math.ceil((44 - size) / 2));
  // Adjacent hit rects must not overlap: each star bleeds `slop` px into
  // the gap from both sides, so the interactive gap has to cover 2×slop
  // or a tap between stars resolves by sibling order, not proximity.
  const gap = interactive ? Math.max(4, slop * 2) : 4;

  // Both modes read as ONE element to screen readers. Interactive pickers
  // are adjustable (swipe up/down to change); read-only rows announce the
  // value directly — the old per-star traversal was five identical
  // "disabled button" stops that never said which stars were filled.
  const setRating = (next: number) => {
    const clamped = Math.min(5, Math.max(1, next));
    if (clamped === value) return;
    Haptics.selectionAsync().catch(() => {});
    onChange?.(clamped);
  };

  return (
    <View
      className="flex-row"
      style={{ gap }}
      accessible
      accessibilityRole={interactive ? 'adjustable' : undefined}
      accessibilityLabel="Rating"
      accessibilityValue={{ min: 0, max: 5, now: value, text: `${value} of 5 stars` }}
      accessibilityActions={
        interactive ? [{ name: 'increment' }, { name: 'decrement' }] : undefined
      }
      onAccessibilityAction={
        interactive
          ? (e) => {
              if (e.nativeEvent.actionName === 'increment') {
                setRating(Math.floor(value) + 1);
              } else if (e.nativeEvent.actionName === 'decrement') {
                setRating(Math.floor(value) - 1);
              }
            }
          : undefined
      }
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.floor(value);
        const halfFilled = !filled && star - 0.5 <= value;

        return (
          <Pressable
            key={star}
            onPress={() => {
              if (readonly) return;
              if (interactive) {
                Haptics.selectionAsync().catch(() => {});
              }
              onChange?.(star);
            }}
            disabled={readonly}
            hitSlop={interactive ? slop : undefined}
            accessibilityRole="button"
            accessibilityLabel={
              interactive
                ? `Rate ${star} of 5 stars`
                : `${star} of 5 stars`
            }
            accessibilityState={{
              disabled: readonly,
              // Reflect fill in both modes — the read-only row used to
              // omit it, so nothing conveyed the rating if a platform
              // ever surfaced the individual stars.
              selected: star <= value,
            }}
          >
            {/* Rating stars are the brand-GOLD accent, not a warning — so
                they source the `accent` family (accentStrong == #F59E0B keeps
                the exact filled look). Unfilled outlines stroke accentDark:
                the base gold on white is ~2.15:1, under the 3:1 floor for
                meaningful UI glyphs, so empty stars washed out in bright
                light. */}
            <Star
              size={size}
              color={filled ? LightColors.accentStrong : LightColors.accentDark}
              fill={filled ? LightColors.accentStrong : halfFilled ? LightColors.accentSoft : 'transparent'}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
