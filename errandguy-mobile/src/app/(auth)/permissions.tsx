import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Image, AppState, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { CheckCircle, Settings as SettingsIcon } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';
import { LightColors } from '../../constants/colors';

const LOCATION_PERMISSION = require('../../../assets/location-permission.png');

/**
 * Location permission screen.
 *
 * Handles the full permission lifecycle — not just the happy path:
 *   • First ask  → OS dialog via requestForegroundPermissionsAsync().
 *   • Denied but can ask again → button re-requests (shows the dialog again).
 *   • Denied AND canAskAgain === false → the OS will NEVER show the dialog
 *     again, so we deep-link the user into the app's Settings page where
 *     they can flip Location on manually. This is the fix for "I skipped /
 *     denied once and now I can't turn GPS on at all."
 *   • On returning from Settings (AppState → active) we re-check the status
 *     so the UI updates without a manual refresh.
 */
export default function LocationPermissionScreen() {
  const router = useRouter();
  const [granted, setGranted] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);

  const refreshStatus = useCallback(async () => {
    const { status, canAskAgain: canAsk } = await Location.getForegroundPermissionsAsync();
    setGranted(status === 'granted');
    setCanAskAgain(canAsk);
  }, []);

  useEffect(() => {
    refreshStatus();
    // Re-check whenever the user comes back to the app (e.g. after toggling
    // the permission in the OS Settings screen).
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshStatus();
    });
    return () => sub.remove();
  }, [refreshStatus]);

  const goNext = () => router.push('/(auth)/contacts-permission');

  const handleAllow = async () => {
    if (granted) return goNext();

    // If the OS won't show the dialog anymore, the ONLY way to grant is via
    // the system Settings page — take the user straight there.
    if (!canAskAgain) {
      await Linking.openSettings();
      return;
    }

    const { status, canAskAgain: canAsk } = await Location.requestForegroundPermissionsAsync();
    setGranted(status === 'granted');
    setCanAskAgain(canAsk);
    // Only advance automatically once they've actually granted — otherwise
    // keep them here so the "Open Settings" affordance can appear.
    if (status === 'granted') goNext();
  };

  const buttonTitle = granted
    ? 'Continue'
    : !canAskAgain
      ? 'Open Settings to enable'
      : 'Allow Location';

  return (
    <SafeAreaView className="flex-1 bg-background" style={s.container}>
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
            <CheckCircle size={16} color={LightColors.success} />
            <Text className="text-[13px] font-montserrat-semi text-success ml-1.5">
              Location access enabled
            </Text>
          </View>
        )}

        {!granted && !canAskAgain && (
          <View style={s.blockedInline}>
            <SettingsIcon size={15} color={LightColors.warning} />
            <Text className="text-[12px] font-montserrat text-textSecondary ml-1.5 flex-1">
              Location is turned off for ErrandGuy. Open {Platform.OS === 'ios' ? 'Settings' : 'App info'} → Permissions → Location to turn it on.
            </Text>
          </View>
        )}
      </View>

      <View style={s.footer}>
        <Button title={buttonTitle} fullWidth size="lg" onPress={handleAllow} />
        {!granted && (
          <Pressable onPress={goNext} hitSlop={8} style={s.skipBtn}>
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
    backgroundColor: LightColors.successLight,
  },
  blockedInline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: LightColors.warningLight,
  },
  footer: { paddingBottom: 28, gap: 4 },
  skipBtn: { paddingVertical: 12 },
});
