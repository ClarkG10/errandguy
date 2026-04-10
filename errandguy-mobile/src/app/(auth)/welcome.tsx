import React, { useRef, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, useWindowDimensions, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OnboardingSlide } from '../../components/auth/OnboardingSlide';
import { DotIndicator } from '../../components/auth/DotIndicator';
import { Button } from '../../components/ui/Button';

const slides = [
  {
    id: '1',
    title: 'Book Any Errand',
    description:
      'From deliveries to rides, get things done with a tap. Post any errand and let a trusted runner handle it.',
    image: require('../../../assets/icon.png'),
  },
  {
    id: '2',
    title: 'Real-Time Tracking',
    description:
      'Know exactly where your runner is. Track every step of your errand on a live map in real time.',
    image: require('../../../assets/icon.png'),
  },
  {
    id: '3',
    title: 'Safe & Secure',
    description:
      'All runners are verified. Enjoy cashless payments, SOS alerts, and trip sharing with trusted contacts.',
    image: require('../../../assets/icon.png'),
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleSkip = useCallback(async () => {
    await AsyncStorage.setItem('@onboarding_seen', 'true');
    router.replace('/(auth)/login');
  }, [router]);

  const handleNext = useCallback(async () => {
    if (activeIndex === slides.length - 1) {
      await AsyncStorage.setItem('@onboarding_seen', 'true');
      router.replace('/(auth)/login');
    } else {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
    }
  }, [activeIndex, router]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: any[] }) => {
      if (viewableItems.length > 0) {
        setActiveIndex(viewableItems[0].index ?? 0);
      }
    },
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row justify-end px-4 pt-2">
        <TouchableOpacity
          cssInterop={false}
          style={ws.skipBtn}
          activeOpacity={0.6}
          onPress={handleSkip}
        >
          <Text cssInterop={false} style={ws.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <OnboardingSlide
            image={item.image}
            title={item.title}
            description={item.description}
          />
        )}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
      />

      <View className="px-6 pb-6">
        <DotIndicator total={slides.length} active={activeIndex} />
        <View className="mt-6">
          <Button
            title={activeIndex === slides.length - 1 ? 'Get Started' : 'Next'}
            fullWidth
            size="lg"
            onPress={handleNext}
          />
        </View>
        <TouchableOpacity
          cssInterop={false}
          style={ws.loginLink}
          activeOpacity={0.6}
          onPress={() => router.push('/(auth)/login')}
        >
          <Text cssInterop={false} style={ws.loginText}>
            Already have an account?{' '}
            <Text cssInterop={false} style={ws.loginBold}>Log In</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const ws = StyleSheet.create({
  skipBtn: { padding: 8 },
  skipText: { fontSize: 14, fontFamily: 'Lato_400Regular', color: '#2563EB' },
  loginLink: { marginTop: 16, alignItems: 'center', padding: 8 },
  loginText: { fontSize: 14, fontFamily: 'Lato_400Regular', color: '#475569' },
  loginBold: { color: '#2563EB', fontFamily: 'Lato_700Bold' },
});
