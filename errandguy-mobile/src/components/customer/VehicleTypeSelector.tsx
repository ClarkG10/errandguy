import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Footprints, Bike, Truck, Car, Check } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { formatCurrency } from '../../utils/formatCurrency';

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
              style={{
                width: 132,
                borderRadius: 16,
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? '#2563EB' : '#E2E8F0',
                backgroundColor: isSelected ? '#EFF6FF' : '#FFFFFF',
                shadowColor: isSelected ? '#2563EB' : '#0F172A',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: isSelected ? 0.12 : 0.04,
                shadowRadius: isSelected ? 12 : 6,
                elevation: isSelected ? 3 : 1,
              }}
            >
              {/* Top row: icon + selection check */}
              <View className="flex-row items-start justify-between">
                <View
                  className="w-11 h-11 rounded-xl items-center justify-center"
                  style={{
                    backgroundColor: isSelected ? '#2563EB' : '#F1F5F9',
                  }}
                >
                  <Icon
                    size={20}
                    color={isSelected ? '#FFFFFF' : '#475569'}
                    strokeWidth={2.2}
                  />
                </View>
                {isSelected ? (
                  <View
                    className="w-5 h-5 rounded-full items-center justify-center"
                    style={{ backgroundColor: '#2563EB' }}
                  >
                    <Check size={12} color="#FFFFFF" strokeWidth={3} />
                  </View>
                ) : isCheapest ? (
                  <View
                    className="px-1.5 py-0.5 rounded-md"
                    style={{ backgroundColor: '#DCFCE7' }}
                  >
                    <Text
                      className="text-[9px] font-montserrat-bold"
                      style={{ color: '#15803D', letterSpacing: 0.4 }}
                    >
                      BEST
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Label + tagline */}
              <Text
                className={`text-[14px] font-montserrat-bold mt-3 ${
                  isSelected ? 'text-primary' : 'text-textPrimary'
                }`}
              >
                {opt.label}
              </Text>
              {tagline && (
                <Text className="text-[10px] font-montserrat text-textSecondary mt-0.5">
                  {tagline}
                </Text>
              )}

              {/* Price + ETA */}
              <View className="mt-2.5">
                {opt.estimatedTotal > 0 ? (
                  <Text
                    className={`text-[15px] font-inter-semi tabular-nums ${
                      isSelected ? 'text-primary' : 'text-textPrimary'
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
                  <Text className="text-[10px] font-montserrat text-textSecondary mt-0.5">
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
