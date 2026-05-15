import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { CheckCircle } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';

const LOCATION_PERMISSION = require('../../../assets/location-permission.png');

/**
 * Location permission screen.
 *
 * Uses the supplied location-permission artwork so the permission
 * screen matches the refreshed onboarding asset pack.
 */
export default function LocationPermissionScreen() {
  const router = useRouter();
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') setGranted(true);
    })();
  }, []);

  const handleAllow = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') setGranted(true);
    router.push('/(auth)/contacts-permission');
  };

  const handleSkip = () => {
    router.push('/(auth)/contacts-permission');
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" style={s.container}>
      <View style={s.content}>
        <Image source={LOCATION_PERMISSION} style={s.illustration} resizeMode="contain" />

        <Text className="text-[26px] font-montserrat-semi text-textPrimary text-center" style={s.title}>
          Allow location access
        </Text>
        <Text className="text-[15px] font-montserrat text-textTertiary text-center" style={s.subtitle}>
          We use your location to find runners nearby and set accurate pickup and dropoff points.
        </Text>

        {granted && (
          <View style={s.grantedInline}>
            <CheckCircle size={16} color="#22C55E" />
            <Text className="text-[13px] font-montserrat-semi text-success ml-1.5">
              Location access enabled
            </Text>
          </View>
        )}
      </View>

      <View style={s.footer}>
        <Button
          title={granted ? 'Continue' : 'Allow Location'}
          fullWidth
          size="lg"
          onPress={granted ? () => router.push('/(auth)/contacts-permission') : handleAllow}
        />
        {!granted && (
          <Pressable onPress={handleSkip} hitSlop={8} style={s.skipBtn}>
            <Text className="text-[14px] font-montserrat text-textTertiary text-center">
              Not now
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: 28 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  illustration: { width: 260, height: 260, marginBottom: 12 },
  title: { marginBottom: 12, lineHeight: 32 },
  subtitle: { lineHeight: 22, paddingHorizontal: 8 },
  grantedInline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ECFDF5',
  },
  footer: { paddingBottom: 28, gap: 4 },
  skipBtn: { paddingVertical: 12 },
});
