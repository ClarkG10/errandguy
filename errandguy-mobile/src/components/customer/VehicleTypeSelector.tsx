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
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
        Vehicle Type
      </Text>
      <View className="flex-row gap-2">
        {options.map((opt) => {
          const Icon = opt.icon;
          const isSelected = selectedKey === opt.key;
          return (
            <Pressable
              key={opt.key}
              className={`flex-1 rounded-xl border p-3 items-center ${
                isSelected
                  ? 'bg-primaryLight border-primary'
                  : 'bg-surface border-divider'
              }`}
              onPress={() => onSelect(opt.key)}
            >
              <Icon
                size={24}
                color={isSelected ? '#2563EB' : '#475569'}
              />
              <Text
                className={`text-xs font-montserrat-bold mt-1 ${
                  isSelected ? 'text-primary' : 'text-textPrimary'
                }`}
              >
                {opt.label}
              </Text>
              <Text className="text-[10px] font-montserrat text-textSecondary mt-0.5">
                {formatCurrency(opt.estimatedTotal)}
              </Text>
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
