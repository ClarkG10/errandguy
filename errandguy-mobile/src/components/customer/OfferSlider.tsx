import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import Slider from '@react-native-community/slider';
import { formatCurrency } from '../../utils/formatCurrency';

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
    return [seed, seed + span / 2, ceil].map((n) =>
      Math.max(min, Math.round(n / 5) * 5),
    );
  }, [min, max, recommendedMin, recommendedMax]);

  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Your Offer
      </Text>

      {/* Headline + inline editable amount */}
      <View className="bg-surface rounded-2xl px-4 py-4 mb-3 border border-divider">
        <Text className="text-[10px] font-montserrat-semi text-textSecondary uppercase tracking-wider mb-1">
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
            placeholderTextColor="#94A3B8"
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
        onSlidingComplete={onChange}
        minimumTrackTintColor="#2563EB"
        maximumTrackTintColor="#E2E8F0"
        thumbTintColor="#2563EB"
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
              onPress={() => onChange(amt)}
              className={`flex-1 py-2 rounded-xl items-center border ${
                active
                  ? 'bg-primary border-primary'
                  : 'bg-surface border-divider'
              }`}
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
