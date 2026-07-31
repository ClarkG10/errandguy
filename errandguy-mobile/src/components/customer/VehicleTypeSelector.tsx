import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatCurrency } from '../../utils/formatCurrency';
import { Elevation, LightColors } from '../../constants/colors';

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

// Short marketing-style descriptors so the user can scan vehicle
// trade-offs at a glance instead of pricing alone.
const VEHICLE_TAGLINES: Record<string, string> = {
  walk: 'Light & nearby',
  bicycle: 'Quick & green',
  motorcycle: 'Fastest',
  car: 'Bulky items',
};

/**
 * Horizontal vehicle chooser — icon-free by design. Each card leads with the
 * vehicle NAME (the anchor now that icons are gone), a one-line trade-off
 * tagline, then the estimated price as the hero figure with its ETA. The
 * cheapest option gets a "Best price" pill; the chosen card fills solid brand
 * blue with white content and a selected dot.
 */
export function VehicleTypeSelector({
  options,
  selectedKey,
  onSelect,
}: VehicleTypeSelectorProps) {
  const cheapestKey = (() => {
    const priced = options.filter((o) => o.estimatedTotal > 0);
    if (priced.length === 0) return undefined;
    return priced.reduce((min, o) =>
      o.estimatedTotal < min.estimatedTotal ? o : min,
    ).key;
  })();

  return (
    <View className="mb-1">
      <View className="flex-row items-baseline justify-between mb-1.5">
        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
          style={{ letterSpacing: 1.4 }}
        >
          Choose vehicle
        </Text>
        {cheapestKey && (
          <Text className="text-[10px] font-montserrat text-textSecondary">
            Tap to compare
          </Text>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Bleed to the screen edges (the review screen's px-5 gutter) so
        // scrolled cards slide under the gutter instead of clipping early;
        // the vertical padding gives the card shadows room inside the clip.
        style={{ marginHorizontal: -20 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 16,
          gap: 10,
        }}
        accessibilityRole="radiogroup"
        accessibilityLabel="Choose vehicle"
      >
        {options.map((opt) => {
          const isSelected = selectedKey === opt.key;
          const isCheapest = cheapestKey === opt.key && options.length > 1;
          const tagline = VEHICLE_TAGLINES[opt.key];
          return (
            <Pressable
              key={opt.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onSelect(opt.key);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, selected: isSelected }}
              accessibilityLabel={`${opt.label}${
                opt.estimatedTotal > 0 ? `, ${formatCurrency(opt.estimatedTotal)}` : ''
              }${opt.eta ? `, about ${opt.eta}` : ''}`}
              // The fill/border MUST live in className: a NativeWind <Pressable>
              // styled only via style={()=>[…]} silently drops backgroundColor,
              // which left the active card transparent (white) with invisible
              // white text. className backgrounds apply reliably.
              className={`border ${
                isSelected ? 'bg-primary border-primary' : 'bg-white border-divider'
              }`}
              style={({ pressed }) => [
                { width: 148, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 14 },
                isSelected ? { ...Elevation.primary, shadowOpacity: 0.22 } : Elevation.sm,
                pressed ? { opacity: 0.94, transform: [{ scale: 0.985 }] } : null,
              ]}
              android_ripple={{ color: `${LightColors.primary}14`, borderless: false }}
            >
              {/* Top row: "Best price" pill and/or the selected dot. No icons. */}
              <View
                className="flex-row items-center justify-between"
                style={{ minHeight: 20 }}
              >
                {isCheapest ? (
                  <View
                    className="px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isSelected
                        ? 'rgba(255,255,255,0.22)'
                        : LightColors.successSoft,
                    }}
                  >
                    <Text
                      className="text-[9px] font-montserrat-bold"
                      style={{
                        color: isSelected ? '#FFFFFF' : LightColors.successDark,
                        letterSpacing: 0.5,
                      }}
                    >
                      BEST PRICE
                    </Text>
                  </View>
                ) : (
                  <View />
                )}
                {isSelected && (
                  <View
                    className="w-4 h-4 rounded-full items-center justify-center"
                    style={{ backgroundColor: 'rgba(255,255,255,0.92)' }}
                    accessibilityElementsHidden
                  >
                    <View
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: LightColors.primary }}
                    />
                  </View>
                )}
              </View>

              {/* Vehicle name — the visual anchor now that icons are removed. */}
              <Text
                numberOfLines={1}
                className={`text-[16px] font-montserrat-bold mt-2.5 ${
                  isSelected ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {opt.label}
              </Text>
              {tagline && (
                <Text
                  numberOfLines={1}
                  className={`text-[11px] font-montserrat mt-0.5 ${
                    isSelected ? 'text-white/90' : 'text-textSecondary'
                  }`}
                >
                  {tagline}
                </Text>
              )}

              {/* Price as the hero figure + ETA. tabular-nums keeps columns steady. */}
              <View className="mt-3.5">
                {opt.estimatedTotal > 0 ? (
                  <Text
                    className={`text-[19px] font-inter-semi tabular-nums ${
                      isSelected ? 'text-white' : 'text-textPrimary'
                    }`}
                  >
                    {formatCurrency(opt.estimatedTotal)}
                  </Text>
                ) : (
                  <View
                    className="h-3.5 rounded-full bg-divider"
                    style={{ width: 60, opacity: 0.6 }}
                  />
                )}
                <Text
                  className={`text-[11px] font-montserrat mt-0.5 ${
                    isSelected ? 'text-white/90' : 'text-textSecondary'
                  }`}
                >
                  {opt.eta ? `~${opt.eta}` : 'ETA —'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export type { VehicleOption };
