import React from 'react';
import { View, Text } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import { MotiView } from 'moti';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';

interface OnboardingSlideProps {
  /**
   * Pre-rendered illustration node — preferred. Accepts any of the
   * SVG components from `OnboardingIllustrations` so the carousel
   * can pass an interactive, vector-perfect scene rather than a
   * raster.
   */
  illustration?: React.ReactNode;
  /**
   * Fallback raster source — kept for backward compatibility with
   * any caller still using the old `image` prop.
   */
  image?: ImageSource | number;
  /** Short uppercase overline rendered above the title. */
  eyebrow?: string;
  title: string;
  description: string;
  /**
   * Whether this slide is the one currently in view. Drives the subtle
   * fade/slide-in entrance — leave undefined (legacy callers) to render
   * statically visible.
   */
  active?: boolean;
  /** The page height. A horizontal FlatList doesn't stretch its cells to
   *  its own height everywhere (web), which left the slide content-sized and
   *  parked the copy far above the page dots. */
  height?: number;
}

/**
 * One slide in the welcome carousel.
 *
 * Prefers a vector `illustration` node (zero asset cost, scales
 * perfectly on every device). Falls back to a raster `image` so we
 * don't break any pre-existing call sites.
 *
 * When the parent passes `active`, the slide content fades/slides in
 * as it becomes the current page. Respects OS Reduce Motion (renders
 * statically, no entrance).
 */
export function OnboardingSlide({
  illustration,
  image,
  eyebrow,
  title,
  description,
  active,
  height,
}: OnboardingSlideProps) {
  const { width, mScale } = useResponsive();
  const reduceMotion = useReducedMotion();

  // Fully visible when: Reduce Motion is on (never hide content behind
  // an animation), or the slide is active, or no `active` prop was given.
  // Inactive slides stay dimmed rather than invisible so neighbouring
  // pages track the finger during a swipe instead of revealing a blank
  // page until the viewability threshold fires.
  const shown = reduceMotion || active !== false;

  return (
    <View
      className="flex-1 items-center justify-center px-8"
      style={height ? { width, height } : { width }}
    >
      <MotiView
        from={reduceMotion ? undefined : { opacity: 0, translateY: 14 }}
        animate={{ opacity: shown ? 1 : 0.4, translateY: shown ? 0 : 6 }}
        transition={{ type: 'timing', duration: reduceMotion ? 0 : 220 }}
        style={{
          flex: 1,
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Artwork and copy are ONE centred group. They used to split the
            page 60/40, which parked the copy mid-screen with a tall empty
            band between it and the page dots. */}
        <View
          style={{ alignItems: 'center', justifyContent: 'center', width: '100%' }}
          // Decorative artwork — hide from screen readers so focus lands
          // straight on the title.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {illustration ? (
            illustration
          ) : image ? (
            <Image
              source={image}
              style={{ width: 240, height: 240 }}
              contentFit="contain"
            />
          ) : null}
        </View>
        <View style={{ alignItems: 'center', paddingHorizontal: 8, marginTop: 28 }}>
          {eyebrow ? (
            <Text
              className="font-montserrat-bold text-primary text-center mb-2"
              style={{ fontSize: 12, letterSpacing: 1.4 }}
            >
              {eyebrow}
            </Text>
          ) : null}
          <Text
            className="font-montserrat-bold text-textPrimary text-center mb-3 tracking-tight"
            style={{ fontSize: mScale(34), lineHeight: mScale(40) }}
            maxFontSizeMultiplier={1.4}
          >
            {title}
          </Text>
          <Text
            className="font-montserrat text-textSecondary text-center"
            style={{ fontSize: 16, lineHeight: 24, maxWidth: 330 }}
          >
            {description}
          </Text>
        </View>
      </MotiView>
    </View>
  );
}
