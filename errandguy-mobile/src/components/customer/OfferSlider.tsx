import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import Slider from '@react-native-community/slider';
import { formatCurrency } from '../../utils/formatCurrency';
import { LightColors } from '../../constants/colors';

interface OfferSliderProps {
  value: number;
  min: number;
  max: number;
  recommendedMin?: number;
  recommendedMax?: number;
  onChange: (value: number) => void;
}

/**
 * OfferSlider — combined slider + numeric input for negotiable offers.
 *
 * Why both? The slider is fast for the common range, but the previous
 * design hard-capped the offer at PHP 500 because the backend doesn't
 * yet emit `recommended_max`. Customers needed to be able to type any
 * legitimate amount above the slider ceiling, so we now:
 *   1. Compute a sensible visual ceiling on the slider (max of
 *      `max` prop and current value) so dragging always feels
 *      proportional even when the user has typed a higher amount.
 *   2. Expose a labeled TextInput that accepts any value >= min.
 *   3. Offer a few quick-pick chips around the recommended band so
 *      first-time users have an obvious starting point.
 */
export function OfferSlider({
  value,
  min,
  max,
  recommendedMin,
  recommendedMax,
  onChange,
}: OfferSliderProps) {
  // Local string state for the input so users can backspace freely
  // without the parent clamping the value mid-edit.
  const [draft, setDraft] = useState(String(value));

  // Last ₱25 detent we ticked for — haptics fire only when the thumb
  // crosses a NEW detent, so a long drag feels like discrete notches
  // instead of a continuous buzz (₱5 steps would tick ~290 times on a
  // 50→1500 drag).
  const lastTickValue = useRef(value);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  // Slider must always be able to represent the current value, even
  // if the user typed an amount above the recommended cap.
  const sliderMax = Math.max(max, value, min + 1);

  const commitDraft = () => {
    const parsed = Math.round(Number(draft) || 0);
    const clamped = Math.max(min, parsed);
    onChange(clamped);
    setDraft(String(clamped));
  };

  const quickPicks = React.useMemo(() => {
    const seed = recommendedMin ?? min;
    const ceil = recommendedMax ?? max;
    const span = Math.max(ceil - seed, 50);
    const picks = [seed, seed + span / 2, ceil].map((n) =>
      Math.max(min, Math.round(n / 5) * 5),
    );
    // A narrow (or clamped) band can collapse picks onto the same amount —
    // dedupe so we never render twin chips that are both "selected".
    return [...new Set(picks)];
  }, [min, max, recommendedMin, recommendedMax]);

  return (
    <View className="mb-4">
      <Text
        className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
        style={{ letterSpacing: 1.4 }}
      >
        Your offer
      </Text>

      {/* Headline + inline editable amount */}
      <View className="bg-surface rounded-2xl px-4 py-4 mb-3 border border-divider">
        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-1"
          style={{ letterSpacing: 1.4 }}
        >
          Amount (PHP)
        </Text>
        <View className="flex-row items-center">
          <Text className="text-3xl font-montserrat-bold text-primary mr-1">
            ₱
          </Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onBlur={commitDraft}
            onSubmitEditing={commitDraft}
            keyboardType="number-pad"
            returnKeyType="done"
            placeholder={String(recommendedMin ?? min)}
            placeholderTextColor={LightColors.textMuted}
            className="flex-1 text-3xl font-montserrat-bold text-primary p-0"
            style={{ paddingVertical: 0 }}
            accessibilityLabel="Offer amount"
          />
        </View>
        <Text className="text-[11px] font-montserrat text-textSecondary mt-1">
          Minimum {formatCurrency(min)}. You can offer any amount above
          this — runners will see your offer first.
        </Text>
      </View>

      <Slider
        value={Math.min(value, sliderMax)}
        minimumValue={min}
        maximumValue={sliderMax}
        step={5}
        // Native slider defaults to ~34-40pt tall — stretch the control
        // box to the 44pt minimum so the thumb is grabbable.
        style={{ height: 44 }}
        onValueChange={(v) => {
          const stepped = Math.round(v);
          // Track the thumb in the headline live — local draft only; the
          // store commit stays on onSlidingComplete so a drag doesn't
          // spam the debounced persist.
          setDraft(String(stepped));
          if (stepped % 25 === 0 && stepped !== lastTickValue.current) {
            lastTickValue.current = stepped;
            Haptics.selectionAsync().catch(() => {});
          }
        }}
        onSlidingComplete={(v) => onChange(Math.round(v))}
        accessibilityLabel="Offer amount"
        accessibilityHint="Swipe up or down to adjust your offer in five peso steps"
        minimumTrackTintColor={LightColors.primary}
        maximumTrackTintColor={LightColors.divider}
        thumbTintColor={LightColors.primary}
      />

      <View className="flex-row justify-between mt-1">
        <Text className="text-xs font-montserrat text-textSecondary">
          {formatCurrency(min)}
        </Text>
        <Text className="text-xs font-montserrat text-textSecondary">
          {formatCurrency(sliderMax)}+
        </Text>
      </View>

      {/* Quick-pick chips around the suggested band */}
      <View className="flex-row gap-2 mt-3">
        {quickPicks.map((amt) => {
          const active = amt === value;
          return (
            <Pressable
              key={amt}
              accessibilityRole="button"
              accessibilityLabel={`Offer ${formatCurrency(amt)}`}
              accessibilityState={{ selected: active }}
              // Chips are 32pt tall (12px label + py-2) — 8pt of slop on
              // each edge lifts the effective target to 48pt.
              hitSlop={8}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange(amt);
              }}
              className={`flex-1 py-2 rounded-xl items-center border ${
                active
                  ? 'bg-primary border-primary'
                  : 'bg-surface border-divider'
              }`}
              // Opacity-only press (no scale) — these chips sit flush in a
              // row and scaling makes neighbours appear to jitter.
              style={({ pressed }) => (pressed ? { opacity: 0.85 } : null)}
            >
              <Text
                className={`text-xs font-montserrat-semi ${
                  active ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {formatCurrency(amt)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {recommendedMin != null && recommendedMax != null && (
        <View className="mt-3 p-3 bg-primaryLight rounded-lg">
          <Text className="text-xs font-montserrat text-primary text-center">
            Suggested: {formatCurrency(recommendedMin)} -{' '}
            {formatCurrency(recommendedMax)}
          </Text>
        </View>
      )}
    </View>
  );
}
