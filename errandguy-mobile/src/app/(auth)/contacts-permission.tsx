import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Users, CheckCircle } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';

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
        <View style={s.illustration}>
          <View style={s.iconCircle}>
            <Users size={36} color="#2563EB" />
          </View>
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
              <CheckCircle size={20} color="#22C55E" style={{ marginRight: 6 }} />
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
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  skipText: {
    paddingVertical: 8,
  },
});
