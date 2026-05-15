import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';

const CONTACT_PERMISSION = require('../../../assets/contact-permission.png');

// expo-contacts requires a native build and is not available in Expo Go.
let Contacts: typeof import('expo-contacts') | null = null;
try {
  Contacts = require('expo-contacts');
} catch {
  // Native module unavailable (e.g. Expo Go)
}

export default function ContactsPermissionScreen() {
  const router = useRouter();
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    if (!Contacts) return;
    (async () => {
      const { status } = await Contacts.getPermissionsAsync();
      if (status === 'granted') setGranted(true);
    })();
  }, []);

  const handleAllow = async () => {
    if (Contacts) {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status === 'granted') {
        setGranted(true);
        return; // stay on screen to show success, user will tap Continue
      }
    }
    // If contacts module not available, just proceed
    if (!Contacts) router.push('/(auth)/login');
  };

  const handleSkip = () => {
    router.push('/(auth)/login');
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" style={s.container}>
      <View style={s.content}>
        <Image source={CONTACT_PERMISSION} style={s.illustration} resizeMode="contain" />

        <Text className="text-[26px] font-montserrat-semi text-textPrimary text-center" style={s.title}>
          Access your contacts
        </Text>
        <Text className="text-[15px] font-montserrat text-textTertiary text-center" style={s.subtitle}>
          Quickly add recipients and trusted contacts from your phone when booking errands.
        </Text>

        {granted && (
          <View style={s.grantedInline}>
            <CheckCircle size={16} color="#22C55E" />
            <Text className="text-[13px] font-montserrat-semi text-success ml-1.5">
              Contacts access enabled
            </Text>
          </View>
        )}
      </View>

      <View style={s.footer}>
        <Button
          title={granted ? 'Continue' : 'Allow Contacts'}
          fullWidth
          size="lg"
          onPress={granted ? () => router.push('/(auth)/login') : handleAllow}
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
