import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Contacts from 'expo-contacts';
import Svg, { Path, Circle as SvgCircle } from 'react-native-svg';
import { Button } from '../../components/ui/Button';

function ContactsIcon({ size = 72 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      {/* Outer ring */}
      <SvgCircle cx="32" cy="32" r="28" stroke="#2563EB" strokeWidth="2" opacity={0.12} />
      <SvgCircle cx="32" cy="32" r="20" stroke="#2563EB" strokeWidth="1.5" opacity={0.08} />
      {/* Person left */}
      <SvgCircle cx="24" cy="24" r="5" fill="#2563EB" opacity={0.7} />
      <Path
        d="M14 40c0-5.52 4.48-8 10-8s10 2.48 10 8"
        stroke="#2563EB"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Person right */}
      <SvgCircle cx="40" cy="24" r="5" fill="#2563EB" />
      <Path
        d="M30 40c0-5.52 4.48-8 10-8s10 2.48 10 8"
        stroke="#2563EB"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export default function ContactsPermissionScreen() {
  const router = useRouter();
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Contacts.getPermissionsAsync();
      if (status === 'granted') setGranted(true);
    })();
  }, []);

  const handleAllow = async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status === 'granted') setGranted(true);
    router.push('/(auth)/login');
  };

  const handleSkip = () => {
    router.push('/(auth)/login');
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" style={s.container}>
      <View style={s.content}>
        <View style={s.illustration}>
          <ContactsIcon size={80} />
        </View>

        <Text className="text-[26px] font-montserrat-semi text-textPrimary text-center" style={s.title}>
          Access your contacts
        </Text>
        <Text className="text-[15px] font-montserrat text-textTertiary text-center" style={s.subtitle}>
          Quickly add recipients and trusted contacts from your phone when booking errands.
        </Text>
      </View>

      <View style={s.footer}>
        {granted ? (
          <>
            <View style={s.grantedBadge}>
              <Text className="text-[14px] font-montserrat-semi text-success">
                Contacts access enabled
              </Text>
            </View>
            <Button
              title="Continue"
              fullWidth
              size="lg"
              onPress={() => router.push('/(auth)/login')}
            />
          </>
        ) : (
          <>
            <Button
              title="Allow Contacts"
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
