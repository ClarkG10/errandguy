import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Footprints, Bike, Truck, Car } from 'lucide-react-native';
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

export function VehicleTypeSelector({
  options,
  selectedKey,
  onSelect,
}: VehicleTypeSelectorProps) {
  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-semi text-textPrimary mb-2">
        Select Vehicle
      </Text>
      <View className="flex-row gap-3">
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = selectedKey === opt.key;
          return (
            <Pressable
              key={opt.key}
              className={`flex-1 rounded-2xl p-3 items-center ${
                isSelected
                  ? 'bg-primaryLight border-2 border-primary'
                  : 'bg-surface border-2 border-transparent'
              }`}
              style={{
                shadowColor: '#0F172A',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: isSelected ? 0.1 : 0.04,
                shadowRadius: 8,
                elevation: isSelected ? 3 : 1,
              }}
              onPress={() => onSelect(opt.key)}
            >
              <View className={`w-11 h-11 rounded-xl items-center justify-center mb-2 ${
                isSelected ? 'bg-primary' : 'bg-divider'
              }`}>
                <Icon
                  size={20}
                  color={isSelected ? '#FFFFFF' : '#475569'}
                />
              </View>
              <Text
                className={`text-xs font-montserrat-semi ${
                  isSelected ? 'text-primary' : 'text-textPrimary'
                }`}
              >
                {opt.label}
              </Text>
              {opt.estimatedTotal > 0 && (
                <Text className={`text-sm font-montserrat-semi mt-0.5 ${
                  isSelected ? 'text-primary' : 'text-textSecondary'
                }`}>
                  {formatCurrency(opt.estimatedTotal)}
                </Text>
              )}
              {opt.eta && (
                <Text className="text-[10px] font-montserrat text-textSecondary">
                  ~{opt.eta}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export { VEHICLE_ICONS };
export type { VehicleOption };
