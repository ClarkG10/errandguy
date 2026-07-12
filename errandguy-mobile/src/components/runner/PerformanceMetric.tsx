import React from 'react';
import { View, Text } from 'react-native';
import { TrendingUp, AlertTriangle } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

interface PerformanceMetricProps {
  /** Number for raw metrics (auto-rounded for percentages); string for
   *  pre-formatted values like ratings ("4.8"). */
  value: number | string;
  label: string;
  /** Ring stroke / glyph tone. A 4px border is a large element, so the
   *  base status tone (3:1) is fine here. */
  color?: string;
  /** Text tone for the value. Split from `color` because the number is
   *  <17px text and must clear the 4.5:1 AA floor — pass a *Dark rung.
   *  Defaults to `color` for call sites that don't distinguish. */
  textColor?: string;
  suffix?: string;
  /** Non-color status signal. Rings alone communicate health via green
   *  vs amber, which is invisible to color-blind users — passing a
   *  status renders a tiny trailing icon (TrendingUp / AlertTriangle)
   *  next to the value and bakes the state into the accessibility
   *  label. */
  status?: 'good' | 'warning';
}

export function PerformanceMetric({
  value,
  label,
  color = LightColors.primary,
  textColor,
  suffix = '%',
  status,
}: PerformanceMetricProps) {
  const displayValue =
    typeof value === 'string'
      ? value
      : suffix === '%'
        ? Math.round(value)
        : value;

  const StatusIcon =
    status === 'warning' ? AlertTriangle : status === 'good' ? TrendingUp : null;

  return (
    <View
      className="flex-1 items-center"
      accessible
      accessibilityLabel={`${label}: ${displayValue}${suffix}${
        status === 'warning'
          ? ', needs attention'
          : status === 'good'
            ? ', on track'
            : ''
      }`}
    >
      <View
        className="w-16 h-16 rounded-full border-4 items-center justify-center"
        style={{ borderColor: color }}
      >
        {/* Cap the value+icon row to the ring's inner width (64 − 2·4 border
            ≈ 56, minus a hair of breathing room) so the worst case ("100%" +
            trend icon) can't poke the ring at large OS font scales. The ring
            geometry stays frozen; instead the numeral shrinks a touch via
            adjustsFontSizeToFit — the same idiom the earnings hero uses — and
            only ever kicks in past ~1.2× where it would otherwise overflow. */}
        <View className="flex-row items-center" style={{ maxWidth: 52 }}>
          <Text
            className="text-[17px] font-montserrat-bold"
            style={{ color: textColor ?? color }}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {displayValue}
            {suffix}
          </Text>
          {StatusIcon ? (
            <StatusIcon
              size={10}
              color={color}
              strokeWidth={2.4}
              style={{ marginLeft: 2 }}
            />
          ) : null}
        </View>
      </View>
      <Text className="text-[12px] font-montserrat text-textSecondary mt-1 text-center">
        {label}
      </Text>
    </View>
  );
}
