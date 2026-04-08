import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Car, Check } from 'lucide-react-native';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
import type { VehicleType } from '../../../types';

const VEHICLE_OPTIONS: { type: VehicleType; label: string; emoji: string }[] = [
  { type: 'walk', label: 'Walking', emoji: '🚶' },
  { type: 'bicycle', label: 'Bicycle', emoji: '🚲' },
  { type: 'motorcycle', label: 'Motorcycle', emoji: '🏍️' },
  { type: 'car', label: 'Car', emoji: '🚗' },
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
      const res = await runnerService.updateRunnerProfile({
        vehicle_type: vehicleType,
      });
      setRunnerProfile(res.data.data);
      Alert.alert('Success', 'Vehicle information updated');
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update vehicle');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Vehicle Information
        </Text>
      </View>

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
                <Text className="text-2xl mb-1">{opt.emoji}</Text>
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
            leftIcon={Car}
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
    </SafeAreaView>
  );
}
