import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import Svg, { Path, Circle as SvgCircle } from 'react-native-svg';
import { Button } from '../../components/ui/Button';

function LocationIcon({ size = 72 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* Outer ring */}
      <SvgCircle cx="32" cy="32" r="28" stroke="#2563EB" strokeWidth="2" opacity={0.12} />
      <SvgCircle cx="32" cy="32" r="20" stroke="#2563EB" strokeWidth="1.5" opacity={0.08} />
      {/* Pin body */}
      <Path
        d="M32 14c-7.18 0-13 5.82-13 13 0 9.75 13 23 13 23s13-13.25 13-23c0-7.18-5.82-13-13-13z"
        fill="#2563EB"
        opacity={0.15}
      />
      <Path
        d="M32 16c-6.07 0-11 4.93-11 11 0 8.25 11 19.5 11 19.5s11-11.25 11-19.5c0-6.07-4.93-11-11-11z"
        fill="#2563EB"
      />
      {/* Inner dot */}
      <SvgCircle cx="32" cy="27" r="4.5" fill="#fff" />
    </Svg>
  );
}

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
        {/* Illustration area */}
        <View style={s.illustration}>
          <LocationIcon size={80} />
        </View>

        <Text className="text-[26px] font-montserrat-semi text-textPrimary text-center" style={s.title}>
          Allow location access
        </Text>
        <Text className="text-[15px] font-montserrat text-textTertiary text-center" style={s.subtitle}>
          We use your location to find runners nearby and set accurate pickup and dropoff points.
        </Text>
      </View>

      <View style={s.footer}>
        {granted ? (
          <>
            <View style={s.grantedBadge}>
              <Text className="text-[14px] font-montserrat-semi text-success">
                Location access enabled
              </Text>
            </View>
            <Button
              title="Continue"
              fullWidth
              size="lg"
              onPress={() => router.push('/(auth)/contacts-permission')}
            />
          </>
        ) : (
          <>
            <Button
              title="Allow Location"
              fullWidth
              size="lg"
              onPress={handleAllow}
            />
            <Text
              className="text-[14px] font-montserrat text-textTertiary text-center"
              style={s.skipText}
              onPress={handleSkip}
            >
              Not now
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 32,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  illustration: {
    marginBottom: 32,
  },
  title: {
    marginBottom: 12,
    lineHeight: 32,
  },
  subtitle: {
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  footer: {
    paddingBottom: 32,
    gap: 16,
  },
  grantedBadge: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    paddingVertical: 8,
  },
});
