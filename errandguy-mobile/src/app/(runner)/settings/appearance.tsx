import React from 'react';
import { View } from 'react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { AppearanceSettings } from '../../../components/settings/AppearanceSettings';

export default function RunnerAppearanceScreen() {
  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Appearance & Accessibility"
        showBack
        fallbackHref="/(runner)/(tabs)/profile"
      />
      <AppearanceSettings />
    </View>
  );
}
