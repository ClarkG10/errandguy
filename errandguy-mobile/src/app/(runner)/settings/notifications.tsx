import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bell, MessageSquare, Star, AlertTriangle } from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import type { LucideIcon } from 'lucide-react-native';

interface NotifPref {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const PREFERENCES: NotifPref[] = [
  {
    key: 'new_errands',
    label: 'New Errand Requests',
    description: 'Get notified when a new errand is available',
    icon: Bell,
  },
  {
    key: 'messages',
    label: 'Chat Messages',
    description: 'Notifications for customer messages',
    icon: MessageSquare,
  },
  {
    key: 'reviews',
    label: 'Reviews & Ratings',
    description: 'Know when a customer leaves a review',
    icon: Star,
  },
  {
    key: 'alerts',
    label: 'Safety Alerts',
    description: 'Important safety and emergency notifications',
    icon: AlertTriangle,
  },
];

export default function NotificationsScreen() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    new_errands: true,
    messages: true,
    reviews: true,
    alerts: true,
  });

  const toggle = (key: string) => {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Notification Preferences
        </Text>
      </View>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Card className="p-0 overflow-hidden">
          {PREFERENCES.map((pref, idx) => (
            <View
              key={pref.key}
              className={`flex-row items-center justify-between p-4 ${
                idx < PREFERENCES.length - 1 ? 'border-b border-divider' : ''
              }`}
            >
              <View className="flex-row items-center gap-3 flex-1 mr-3">
                <pref.icon size={20} color="#475569" />
                <View className="flex-1">
                  <Text className="text-sm font-montserrat-bold text-textPrimary">
                    {pref.label}
                  </Text>
                  <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
                    {pref.description}
                  </Text>
                </View>
              </View>
              <Switch
                value={prefs[pref.key]}
                onValueChange={() => toggle(pref.key)}
                trackColor={{ false: '#CBD5E1', true: '#93C5FD' }}
                thumbColor={prefs[pref.key] ? '#2563EB' : '#F1F5F9'}
              />
            </View>
          ))}
        </Card>

        <Text className="text-xs font-montserrat text-textSecondary mt-4 text-center px-4">
          Safety alerts cannot be fully disabled for your protection.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
