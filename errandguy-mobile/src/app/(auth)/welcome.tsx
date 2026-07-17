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
import { MotiView } from 'moti';
import { OnboardingSlide } from '../../components/auth/OnboardingSlide';
import { Illustration } from '../../components/ui/Illustration';
import { Button } from '../../components/ui/Button';
import { LightColors } from '../../constants/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

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
      'Groceries, medicine, food, documents — book it in a tap and a verified runner takes care of the rest.',
    image: 'onboarding-book' as const,
  },
  {
    id: '2',
    eyebrow: 'HOW IT WORKS',
    title: 'Real-time tracking',
    description:
      'Watch your runner move on a live map, every step of the way. No guessing, no waiting in the dark.',
    image: 'onboarding-track' as const,
  },
  {
    id: '3',
    eyebrow: 'WHY YOU CAN TRUST IT',
    title: 'Safe & secure',
    description:
      'Verified runners, cashless payments, SOS alerts and trip sharing — every errand has your back.',
    image: 'onboarding-safety' as const,
  },
];

const HERO_GRADIENT = [LightColors.primaryLight, LightColors.surface] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const reduceMotion = useReducedMotion();
  // Both exit handlers await AsyncStorage before routing, which widens
  // the double-tap window — guard so a second tap can't stack the
  // permissions screen twice.
  const navigatingRef = useRef(false);

  // Vector hero — crisp at every density, and responsive so tablets
  // don't get a small floating stamp.
  const heroSize = Math.min(width * 0.64, 300);

  const handleSkip = useCallback(async () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    Haptics.selectionAsync().catch(() => {});
    await AsyncStorage.setItem('@onboarding_seen', 'true');
    // replace: once onboarding is seen, welcome is a dead back path.
    router.replace('/(auth)/permissions');
  }, [router]);

  const handleNext = useCallback(async () => {
    if (activeIndex === slides.length - 1) {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      Haptics.selectionAsync().catch(() => {});
      await AsyncStorage.setItem('@onboarding_seen', 'true');
      router.replace('/(auth)/permissions');
    } else {
      Haptics.selectionAsync().catch(() => {});
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
          extraData={activeIndex}
          renderItem={({ item, index }) => (
            <OnboardingSlide
              illustration={<Illustration name={item.image} size={heroSize} />}
              eyebrow={item.eyebrow}
              title={item.title}
              description={item.description}
              active={index === activeIndex}
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
          {/* Pager status — dots + "1 / 3" counter. The container carries
              the announcement so screen readers hear "Slide X of 3" as the
              user pages through. */}
          <View
            style={styles.pagerStatus}
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={`Slide ${activeIndex + 1} of ${slides.length}`}
          >
            <View style={styles.pageIndicator}>
              {slides.map((slide, i) => (
                <MotiView
                  key={slide.id}
                  style={styles.pageDot}
                  animate={{
                    width: i === activeIndex ? 22 : 6,
                    backgroundColor:
                      i === activeIndex
                        ? LightColors.primary
                        : LightColors.dividerStrong,
                  }}
                  transition={{
                    type: 'timing',
                    duration: reduceMotion ? 0 : 200,
                  }}
                />
              ))}
            </View>
            <Text style={styles.pageCounter}>
              {activeIndex + 1} / {slides.length}
            </Text>
          </View>

          {/* Bottom action row — ghost Skip + solid Next (reference layout).
              On the last slide Skip duplicates "Get Started", so it is removed
              ENTIRELY from layout (not just faded) — otherwise its reserved
              width pushes the flex:1 Next button ~84px to the right and it no
              longer reads as centered/full-width. */}
          <View style={styles.actionRow}>
            {!isLast && (
              <MotiView
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ type: 'timing', duration: reduceMotion ? 0 : 180 }}
              >
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
              </MotiView>
            )}
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
            <Text className="text-[14px] font-montserrat text-textTertiary">
              Already have an account?{' '}
            </Text>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                router.push('/(auth)/login');
              }}
              hitSlop={12}
              accessibilityLabel="Log in to existing account"
              accessibilityRole="button"
              style={({ pressed }) => pressed && { opacity: 0.55 }}
            >
              <Text className="text-[14px] font-montserrat-semi text-primary">
                Log in
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

// Matches the app-wide `font-montserrat-semi` alias (Quicksand_500Medium
// on Android, System 500 on iOS) — 600SemiBold isn't part of that alias.
const FONT_SEMI =
  Platform.OS === 'ios' ? 'System' : 'Quicksand_500Medium';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: LightColors.surface },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    // Bottom padding applied inline — respects the home-indicator inset.
    alignItems: 'stretch',
  },
  pagerStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  pageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
  },
  pageCounter: {
    fontFamily: FONT_SEMI,
    fontWeight: '500',
    fontSize: 12,
    letterSpacing: 0.4,
    color: LightColors.textMuted,
  },
  // Width + colour of the active dot are animated inline (MotiView).
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: LightColors.dividerStrong,
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
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  nextBtnWrap: { flex: 1 },
  loginRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    paddingVertical: 6,
  },
});
