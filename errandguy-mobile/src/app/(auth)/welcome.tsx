import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  useWindowDimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { OnboardingSlide } from '../../components/auth/OnboardingSlide';
import { Button } from '../../components/ui/Button';
import { LightColors } from '../../constants/colors';

const ONBOARDING_1 = require('../../../assets/ONBOARDING-1.png');
const ONBOARDING_2 = require('../../../assets/ONBOARDING-2.png');
const ONBOARDING_3 = require('../../../assets/ONBOARDING-3.png');

/**
 * Welcome — onboarding carousel on a clean white canvas.
 *
 * Reference aesthetic: large friendly illustration area, big bold
 * two-line heading, short secondary subtitle, dot page indicators in
 * primary, and a bottom row pairing a ghost "Skip" with a solid pill
 * primary "Next" button.
 *
 * Business contracts preserved verbatim:
 *   - AsyncStorage key `@onboarding_seen`
 *   - Routes: `/(auth)/permissions`, `/(auth)/login`
 *   - 3-slide content
 *   - Light selection haptic on skip and next
 */
const slides = [
  {
    id: '1',
    eyebrow: 'WHAT IT DOES',
    title: 'Book any errand',
    description:
      'From deliveries to rides, get things done with a tap. Post any errand and a verified runner takes it from there.',
    image: ONBOARDING_1,
  },
  {
    id: '2',
    eyebrow: 'HOW IT WORKS',
    title: 'Real-time tracking',
    description:
      'Know exactly where your runner is. Every step appears on a live map until your errand is complete.',
    image: ONBOARDING_2,
  },
  {
    id: '3',
    eyebrow: 'WHY YOU CAN TRUST IT',
    title: 'Safe & secure',
    description:
      'All runners are verified. Cashless payments, SOS alerts and trip sharing keep every errand accountable.',
    image: ONBOARDING_3,
  },
];

const HERO_GRADIENT = [LightColors.primaryLight, LightColors.surface] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleSkip = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    await AsyncStorage.setItem('@onboarding_seen', 'true');
    router.push('/(auth)/permissions');
  }, [router]);

  const handleNext = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    if (activeIndex === slides.length - 1) {
      await AsyncStorage.setItem('@onboarding_seen', 'true');
      router.push('/(auth)/permissions');
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

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  const isLast = activeIndex === slides.length - 1;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={HERO_GRADIENT}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          data={slides}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <OnboardingSlide
              illustration={item.illustration}
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

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.pageIndicator}>
            {slides.map((slide, i) => (
              <View
                key={slide.id}
                style={[
                  styles.pageDot,
                  i === activeIndex ? styles.pageDotActive : null,
                ]}
              />
            ))}
          </View>

          {/* Bottom action row — ghost Skip + solid pill Next (reference layout). */}
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleSkip}
              hitSlop={12}
              accessibilityLabel="Skip onboarding"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.skipBtn,
                pressed ? { opacity: 0.55 } : null,
              ]}
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
            <View style={styles.nextBtnWrap}>
              <Button
                title={isLast ? 'Get Started' : 'Next'}
                fullWidth
                size="lg"
                onPress={handleNext}
              />
            </View>
          </View>

          <View style={styles.loginRow}>
            <Pressable
              onPress={() => router.push('/(auth)/login')}
              hitSlop={12}
              accessibilityLabel="Log in to existing account"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.loginPressable,
                pressed ? { opacity: 0.55 } : null,
              ]}
            >
              <Text style={styles.loginText}>
                Already have an account?{' '}
                <Text style={styles.loginLink}>Log in</Text>
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const FONT_BODY =
  Platform.OS === 'ios' ? 'System' : 'Quicksand_400Regular';
const FONT_SEMI =
  Platform.OS === 'ios' ? 'System' : 'Quicksand_600SemiBold';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: LightColors.surface },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    // Bottom padding applied inline — respects the home-indicator inset.
    alignItems: 'stretch',
  },
  pageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 28,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: LightColors.dividerStrong,
  },
  pageDotActive: {
    width: 22,
    backgroundColor: LightColors.primary,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skipBtn: {
    minWidth: 72,
    minHeight: 54,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  skipText: {
    color: LightColors.primary,
    fontSize: 16,
    fontFamily: FONT_SEMI,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  nextBtnWrap: { flex: 1 },
  loginRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  loginPressable: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginText: {
    fontFamily: FONT_BODY,
    fontWeight: '400',
    fontSize: 15,
    color: LightColors.textTertiary,
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  loginLink: {
    fontFamily: FONT_SEMI,
    fontWeight: '600',
    color: LightColors.primary,
  },
});
