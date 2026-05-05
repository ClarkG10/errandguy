import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, PersonStanding, Bike, Car } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
import type { VehicleType } from '../../../types';
import { toast } from '../../../stores/toastStore';

// Lucide doesn't ship a motorcycle glyph, so we reuse `Bike` for the
// two-wheeled options and let the label disambiguate.
const VEHICLE_OPTIONS: { type: VehicleType; label: string; Icon: LucideIcon }[] = [
  { type: 'walk', label: 'Walking', Icon: PersonStanding },
  { type: 'bicycle', label: 'Bicycle', Icon: Bike },
  { type: 'motorcycle', label: 'Motorcycle', Icon: Bike },
  { type: 'car', label: 'Car', Icon: Car },
];

export default function VehicleScreen() {
  const router = useRouter();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();

  const [vehicleType, setVehicleType] = useState<VehicleType>(
    runnerProfile?.vehicle_type ?? 'motorcycle',
  );
  const [plate, setPlate] = useState(runnerProfile?.vehicle_plate ?? '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      const data: Record<string, string> = {
        vehicle_type: vehicleType,
      };
      if (vehicleType === 'motorcycle' || vehicleType === 'car') {
        data.vehicle_plate = plate;
      }
      const res = await runnerService.updateRunnerProfile(data);
      setRunnerProfile(res.data.data);
      toast.success('Vehicle information updated');
      if (router.canGoBack()) router.back(); else router.replace('/(runner)/(tabs)/profile');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to update vehicle');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Vehicle Information" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Text className="text-sm font-montserrat-bold text-textPrimary mb-3">
          Vehicle Type
        </Text>

        <View className="flex-row flex-wrap gap-3 mb-6">
          {VEHICLE_OPTIONS.map((opt) => {
            const selected = vehicleType === opt.type;
            return (
              <Pressable
                key={opt.type}
                onPress={() => setVehicleType(opt.type)}
                className={`flex-1 min-w-[45%] rounded-xl border-2 p-4 items-center ${
                  selected ? 'border-primary bg-primaryLight' : 'border-divider bg-surface'
                }`}
              >
                <opt.Icon
                  size={26}
                  color={selected ? '#2563EB' : '#64748B'}
                  strokeWidth={1.8}
                  style={{ marginBottom: 6 }}
                />
                <Text
                  className={`text-sm font-montserrat-bold ${
                    selected ? 'text-primary' : 'text-textSecondary'
                  }`}
                >
                  {opt.label}
                </Text>
                {selected && (
                  <View className="absolute top-2 right-2">
                    <Check size={16} color="#2563EB" />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {(vehicleType === 'motorcycle' || vehicleType === 'car') && (
          <Input
            label="Plate Number"
            value={plate}
            onChangeText={setPlate}
            placeholder="ABC 1234"
            autoCapitalize="characters"
          />
        )}

        <Button
          title="Save Changes"
          onPress={handleSave}
          loading={loading}
          fullWidth
        />
      </ScrollView>
    </View>
  );
}
