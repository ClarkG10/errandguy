import React from 'react';
import { ActivityIndicator, Platform, View, Text, ViewStyle } from 'react-native';
import { ErrandLoader } from './ErrandLoader';
import { LightColors } from '../../constants/colors';

export interface SpinnerProps {
  /**
   * iOS uses the platform-native ActivityIndicator (HIG-correct, weighty).
   * Android uses our ErrandLoader dot animation (the Material spinner
   * looks foreign next to our brand and clashes with the rest of the UI).
   * Force a specific renderer with `kind`.
   */
  kind?: 'auto' | 'native' | 'brand';
  size?: 'small' | 'large' | number;
  color?: string;
}

/**
 * Platform-aware spinner. Use everywhere instead of raw ActivityIndicator.
 * On iOS: native UIActivityIndicatorView (light, blends with system).
 * On Android: branded three-dot pulse via ErrandLoader.
 */
export function Spinner({
  kind = 'auto',
  size = 'small',
  color = LightColors.primary,
}: SpinnerProps) {
  const useBrand =
    kind === 'brand' || (kind === 'auto' && Platform.OS === 'android');

  if (useBrand) {
    const dot =
      typeof size === 'number' ? size : size === 'large' ? 12 : 8;
    return <ErrandLoader size={dot} color={color} />;
  }
  return <ActivityIndicator size={size === 'large' ? 'large' : 'small'} color={color} />;
}

export interface CenteredLoaderProps extends SpinnerProps {
  /** Optional caption rendered below the spinner. */
  message?: string;
  /** Background colour for the wrapper. Defaults to transparent. */
  background?: string;
  style?: ViewStyle;
}

/**
 * Full-flex centered loader. Drop into screens whose root is `flex-1`
 * to guarantee correct vertical+horizontal centering — fixes the most
 * common "loader stuck in the corner" bug where parents forgot to set
 * `flex: 1` on the loader's container.
 */
export function CenteredLoader({
  message,
  background,
  style,
  ...spinner
}: CenteredLoaderProps) {
  return (
    <View
      style={[
        {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
        },
        style,
      ]}
    >
      <Spinner size="large" {...spinner} />
      {message ? (
        <Text
          style={{
            marginTop: 12,
            fontSize: 13,
            color: LightColors.textTertiary,
            fontFamily: Platform.select({ ios: 'System', android: 'Montserrat_500Medium' }),
          }}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}
