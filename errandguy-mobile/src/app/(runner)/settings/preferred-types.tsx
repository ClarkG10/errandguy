import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';

interface ErrandTypeOption {
  id: string;
  slug: string;
  name: string;
  selected: boolean;
}

export default function PreferredTypesScreen() {
  const router = useRouter();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();

  const [types, setTypes] = useState<ErrandTypeOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Common errand types (would normally come from API)
  const defaultTypes = [
    { id: '1', slug: 'delivery', name: 'Delivery' },
    { id: '2', slug: 'purchase', name: 'Purchase & Deliver' },
    { id: '3', slug: 'transportation', name: 'Transportation' },
    { id: '4', slug: 'document', name: 'Document Processing' },
    { id: '5', slug: 'queue', name: 'Queue & Wait' },
    { id: '6', slug: 'moving', name: 'Moving Assistance' },
  ];

  useEffect(() => {
    const preferred = runnerProfile?.preferred_types ?? [];
    setTypes(
      defaultTypes.map((t) => ({
        ...t,
        selected: preferred.includes(t.slug),
      })),
    );
  }, [runnerProfile]);

  const toggleType = (slug: string) => {
    setTypes((prev) =>
      prev.map((t) => (t.slug === slug ? { ...t, selected: !t.selected } : t)),
    );
  };

  const handleSave = async () => {
    const selected = types.filter((t) => t.selected).map((t) => t.slug);
    if (selected.length === 0) {
      Alert.alert('Required', 'Please select at least one errand type.');
      return;
    }

    setSaving(true);
    try {
      await runnerService.updateRunnerProfile({ preferred_types: selected });
      Alert.alert('Success', 'Preferred errand types updated');
      const res = await runnerService.getRunnerProfile();
      setRunnerProfile(res.data.data);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await runnerService.getRunnerProfile();
      setRunnerProfile(res.data.data);
    } catch {}
    setRefreshing(false);
  }, []);

  const selectedCount = types.filter((t) => t.selected).length;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            Preferred Errand Types
          </Text>
          <Text className="text-xs font-montserrat text-textSecondary">
            {selectedCount} selected • min 1 required
          </Text>
        </View>
      </View>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <Text className="text-sm font-montserrat text-textSecondary mb-3">
          Select the errand types you want to receive requests for.
        </Text>
        {types.map((type) => (
          <Pressable key={type.slug} onPress={() => toggleType(type.slug)}>
            <Card className={`mb-2 p-4 flex-row items-center justify-between ${type.selected ? 'border-primary' : ''}`}>
              <Text className="text-sm font-montserrat-bold text-textPrimary">
                {type.name}
              </Text>
              <View
                className={`w-6 h-6 rounded-full items-center justify-center ${
                  type.selected ? 'bg-primary' : 'border-2 border-divider'
                }`}
              >
                {type.selected && <Check size={14} color="#FFFFFF" />}
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>

      {/* Save Button */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <Button title="Save Preferences" onPress={handleSave} loading={saving} fullWidth />
      </View>
    </SafeAreaView>
  );
}
