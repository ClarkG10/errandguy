import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Footprints, Bike, Truck, Car, Check } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { formatCurrency } from '../../utils/formatCurrency';
import { LightColors } from '../../constants/colors';

interface VehicleOption {
  key: string;
  label: string;
  icon: LucideIcon;
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
  motorcycle: Truck,
  car: Car,
};

// Short marketing-style descriptors so the user can scan vehicle
// trade-offs at a glance instead of pricing alone.
const VEHICLE_TAGLINES: Record<string, string> = {
  walk: 'Light & nearby',
  bicycle: 'Quick & green',
  motorcycle: 'Fastest',
  car: 'Bulky items',
};

export function VehicleTypeSelector({
  options,
  selectedKey,
  onSelect,
}: VehicleTypeSelectorProps) {
  // Cheapest option gets a discrete "Best price" pill so the user can
  // anchor their decision quickly. Falls back to undefined if no option
  // has resolved a price yet.
  const cheapestKey = (() => {
    const priced = options.filter((o) => o.estimatedTotal > 0);
    if (priced.length === 0) return undefined;
    return priced.reduce((min, o) =>
      o.estimatedTotal < min.estimatedTotal ? o : min,
    ).key;
  })();

  return (
    <View className="mb-5">
      <View className="flex-row items-baseline justify-between mb-2.5">
        <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
          style={{ letterSpacing: 1.4 }}
        >
          Choose vehicle
        </Text>
        {cheapestKey && (
          <Text className="text-[10px] font-montserrat text-textTertiary">
            Tap to compare
          </Text>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 4, gap: 10 }}
      >
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = selectedKey === opt.key;
          const isCheapest = cheapestKey === opt.key && options.length > 1;
          const tagline = VEHICLE_TAGLINES[opt.key];
          return (
            <Pressable
              key={opt.key}
              onPress={() => onSelect(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${opt.label}${
                opt.estimatedTotal > 0 ? ` ${formatCurrency(opt.estimatedTotal)}` : ''
              }`}
              // Ride-hailing selection pattern — chosen card fills solid
              // brand blue with white content; the rest stay quiet white.
              style={{
                width: 132,
                borderRadius: 20,
                paddingVertical: 14,
                paddingHorizontal: 12,
                backgroundColor: isSelected ? LightColors.primary : LightColors.surface,
                shadowColor: isSelected ? LightColors.primaryDark : LightColors.textPrimary,
                shadowOffset: { width: 0, height: isSelected ? 8 : 2 },
                shadowOpacity: isSelected ? 0.22 : 0.04,
                shadowRadius: isSelected ? 18 : 12,
                elevation: isSelected ? 5 : 1,
              }}
            >
              {/* Top row: icon + selection check */}
              <View className="flex-row items-start justify-between">
                <View
                  className="w-11 h-11 rounded-xl items-center justify-center"
                  style={{
                    backgroundColor: isSelected
                      ? 'rgba(255,255,255,0.18)'
                      : LightColors.surfaceMuted,
                  }}
                >
                  <Icon
                    size={20}
                    color={isSelected ? LightColors.textInverse : LightColors.textSecondary}
                    strokeWidth={2.2}
                  />
                </View>
                {isSelected ? (
                  <View
                    className="w-5 h-5 rounded-full items-center justify-center"
                    style={{ backgroundColor: 'rgba(255,255,255,0.25)' }}
                  >
                    <Check size={12} color={LightColors.textInverse} strokeWidth={3} />
                  </View>
                ) : isCheapest ? (
                  <View
                    className="px-1.5 py-0.5 rounded-md"
                    style={{ backgroundColor: LightColors.successSoft }}
                  >
                    <Text
                      className="text-[9px] font-montserrat-bold"
                      style={{ color: LightColors.success, letterSpacing: 0.4 }}
                    >
                      BEST
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Label + tagline */}
              <Text
                className={`text-[14px] font-montserrat-bold mt-3 ${
                  isSelected ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {opt.label}
              </Text>
              {tagline && (
                <Text
                  className={`text-[10px] font-montserrat mt-0.5 ${
                    isSelected ? 'text-white/75' : 'text-textSecondary'
                  }`}
                >
                  {tagline}
                </Text>
              )}

              {/* Price + ETA */}
              <View className="mt-2.5">
                {opt.estimatedTotal > 0 ? (
                  <Text
                    className={`text-[15px] font-inter-semi tabular-nums ${
                      isSelected ? 'text-white' : 'text-textPrimary'
                    }`}
                  >
                    {formatCurrency(opt.estimatedTotal)}
                  </Text>
                ) : (
                  <View
                    className="h-3 rounded-full bg-divider"
                    style={{ width: 56, opacity: 0.6 }}
                  />
                )}
                {opt.eta && (
                  <Text
                    className={`text-[10px] font-montserrat mt-0.5 ${
                      isSelected ? 'text-white/75' : 'text-textSecondary'
                    }`}
                  >
                    ~{opt.eta}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export { VEHICLE_ICONS };
export type { VehicleOption };
