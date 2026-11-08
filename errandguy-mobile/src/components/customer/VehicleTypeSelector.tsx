import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Bike, CarFront, Check, Footprints, Motorbike, type LucideIcon } from 'lucide-react-native';
import { formatCurrency } from '../../utils/formatCurrency';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Skeleton } from '../ui/Skeleton';
import { PressableScale } from './booking/PressableScale';
import { BookingSectionHeader } from './booking/BookingSectionHeader';

interface VehicleOption {
  key: string;
  label: string;
  perKm: number;
  estimatedTotal: number;
  eta?: string;
}

interface VehicleTypeSelectorProps {
  options: VehicleOption[];
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
}

const VEHICLE_ICONS: Record<string, LucideIcon> = {
  walk: Footprints,
  bicycle: Bike,
  motorcycle: Motorbike,
  car: CarFront,
};

// What each vehicle is good for — the trade-off line under its name. Speed
// and price are NOT claimed here: those come from the data (the ETA beside
// this line, and the "Cheapest"/"Fastest" tags).
const VEHICLE_TAGLINES: Record<string, string> = {
  walk: 'Light & nearby',
  bicycle: 'Quick & green',
  motorcycle: 'Beats traffic',
  car: 'Bulky items',
};

const TABULAR = { fontVariant: ['tabular-nums' as const] };

/** "35 min" → 35, "1h 5m" → 65, "< 1 min" → 0.5; null when there's no ETA. */
function etaMinutes(eta: string | undefined): number | null {
  if (!eta) return null;
  if (eta.trim().startsWith('<')) return 0.5;
  const hours = /(\d+)h\s*(\d+)m/.exec(eta);
  if (hours) return Number(hours[1]) * 60 + Number(hours[2]);
  const mins = /(\d+)\s*min/.exec(eta);
  return mins ? Number(mins[1]) : null;
}

/**
 * The one option that is strictly lowest on `value` — or nothing. A tag that
 * every option shares (or a tie) says nothing, so it isn't shown.
 */
function uniqueLowest(
  options: VehicleOption[],
  value: (o: VehicleOption) => number | null,
): string | undefined {
  const valued = options
    .map((o) => ({ key: o.key, v: value(o) }))
    .filter((o): o is { key: string; v: number } => o.v != null);
  if (valued.length < 2) return undefined;
  const min = Math.min(...valued.map((o) => o.v));
  const lowest = valued.filter((o) => o.v === min);
  return lowest.length === 1 ? lowest[0].key : undefined;
}

/** The selected row's check: scales in on selection (instant under Reduce Motion). */
function RadioMark({ selected }: { selected: boolean }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    const target = selected ? 1 : 0;
    scale.value = reduceMotion
      ? target
      : withTiming(target, { duration: 200, easing: Easing.out(Easing.quad) });
  }, [selected, reduceMotion, scale]);

  const fillStyle = useAnimatedStyle(() => ({
    opacity: scale.value,
    transform: [{ scale: 0.6 + 0.4 * scale.value }],
  }));

  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        borderColor: selected ? LightColors.primary : LightColors.dividerStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: -1.5,
            left: -1.5,
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: LightColors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          },
          fillStyle,
        ]}
      >
        <Check size={13} color={LightColors.textInverse} strokeWidth={3} />
      </Animated.View>
    </View>
  );
}

function Tag({ label, tone }: { label: string; tone: 'success' | 'primary' }) {
  return (
    <View
      className="ml-2 px-2 rounded-full"
      style={{
        paddingVertical: 2,
        backgroundColor: tone === 'success' ? LightColors.successSoft : LightColors.primarySoft,
      }}
    >
      <Text
        className="text-[11px] font-montserrat-bold"
        style={{ color: tone === 'success' ? LightColors.successDark : LightColors.primaryDark }}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Vehicle chooser — a vertical list of option rows. Each row shows the real
 * vehicle (a lucide icon in a tinted circle), what it's good for and its ETA,
 * and the price right-aligned in tabular figures. "Cheapest" / "Fastest" tags
 * appear only where the data makes them true for exactly one option.
 *
 * The chosen row gets a primary ring, a tinted fill and a check — calm, never
 * a solid block. Rows settle slightly under the finger; the check scales in on
 * selection. Both respect Reduce Motion.
 */
export function VehicleTypeSelector({
  options,
  selectedKey,
  onSelect,
}: VehicleTypeSelectorProps) {
  const cheapestKey = uniqueLowest(options, (o) => (o.estimatedTotal > 0 ? o.estimatedTotal : null));
  const fastestKey = uniqueLowest(options, (o) => etaMinutes(o.eta));

  return (
    <View>
      <BookingSectionHeader title="Choose a vehicle" />
      <View accessibilityRole="radiogroup" accessibilityLabel="Choose vehicle" style={{ gap: 8 }}>
        {options.map((opt) => {
          const isSelected = selectedKey === opt.key;
          const Icon = VEHICLE_ICONS[opt.key] ?? CarFront;
          const tagline = VEHICLE_TAGLINES[opt.key];
          const isCheapest = cheapestKey === opt.key;
          const isFastest = fastestKey === opt.key;
          const priced = opt.estimatedTotal > 0;
          const detail = [tagline, opt.eta ? `~${opt.eta}` : null].filter(Boolean).join(' · ');

          return (
            <PressableScale
              key={opt.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onSelect(opt.key);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, selected: isSelected }}
              accessibilityLabel={[
                opt.label,
                priced ? formatCurrency(opt.estimatedTotal) : null,
                opt.eta ? `about ${opt.eta}` : null,
                isCheapest ? 'cheapest' : null,
                isFastest ? 'fastest' : null,
              ]
                .filter(Boolean)
                .join(', ')}
              android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
              contentStyle={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 68,
                paddingVertical: 12,
                paddingLeft: 12,
                paddingRight: 14,
                borderRadius: Radius.card,
                borderWidth: 1.5,
                borderColor: isSelected ? LightColors.primary : LightColors.divider,
                backgroundColor: isSelected ? LightColors.surfaceTinted : LightColors.surface,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  // On the tinted (selected) row the circle turns white so it
                  // still reads as a disc instead of melting into the fill.
                  backgroundColor: isSelected ? LightColors.surface : LightColors.primary50,
                }}
              >
                <Icon size={20} color={LightColors.primary} strokeWidth={2} />
              </View>

              <View className="flex-1 ml-3">
                <View className="flex-row items-center flex-wrap">
                  <Text className="text-[15px] font-montserrat-bold text-textPrimary">
                    {opt.label}
                  </Text>
                  {isCheapest && <Tag label="Cheapest" tone="success" />}
                  {isFastest && <Tag label="Fastest" tone="primary" />}
                </View>
                {detail ? (
                  <Text
                    className="text-[13px] font-montserrat text-textSecondary mt-0.5"
                    style={TABULAR}
                  >
                    {detail}
                  </Text>
                ) : null}
              </View>

              <View className="ml-3 mr-3 items-end" style={{ minWidth: 64 }}>
                {priced ? (
                  <Text className="text-[15px] font-inter-semi text-textPrimary" style={TABULAR}>
                    {formatCurrency(opt.estimatedTotal)}
                  </Text>
                ) : (
                  <Skeleton width={64} height={14} borderRadius={7} />
                )}
              </View>

              <RadioMark selected={isSelected} />
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export type { VehicleOption };
