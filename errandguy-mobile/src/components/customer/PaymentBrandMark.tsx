import React from 'react';
import { View, Text, Image, type ViewStyle } from 'react-native';
import { Wallet, Banknote } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import type { PaymentMethodType } from '../../types';

/**
 * PaymentBrandMark — a brand-accurate logo badge for each payment method.
 *
 * Renders recognizable, brand-coloured marks so the payment sheet reads like a
 * real wallet picker instead of a row of generic glyphs:
 *
 *   • GCash / Maya — the provider's OFFICIAL brand colour as a filled tile
 *     with its wordmark initial in white (blue "G", emerald "M").
 *   • Wallet — ErrandGuy brand blue (our own balance); Cash — money green.
 *
 * These are simplified, non-proprietary identifying marks built from official
 * brand COLOURS + plain wordmark initials. To use fully-licensed official
 * artwork, drop a file at `assets/pay/<type>.png` and add it to `ART` below
 * (keys: gcash | maya | wallet | cash) — the badge then renders the real logo
 * with zero call-site changes.
 */

// Official brand colours (verified): GCash #007CFF, Maya vivid emerald.
const TILE_BG: Record<PaymentMethodType, string> = {
  gcash: '#007CFF',
  maya: '#10C98E',
  wallet: LightColors.primary,
  cash: '#16A34A',
};

// Optional real artwork override. Add e.g.
// `gcash: require('../../../assets/pay/gcash.png')` to render the official logo
// instead of the vector mark.
const ART: Partial<Record<PaymentMethodType, number>> = {};

interface PaymentBrandMarkProps {
  type: PaymentMethodType;
  size?: number;
  style?: ViewStyle;
}

export function PaymentBrandMark({ type, size = 40, style }: PaymentBrandMarkProps) {
  const radius = Math.round(size * 0.28); // squircle — reads as a logo tile
  const art = ART[type];

  const tileStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    backgroundColor: TILE_BG[type] ?? LightColors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  if (art) {
    return (
      <View style={[tileStyle, style]}>
        <Image
          source={art}
          style={{ width: size, height: size }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }

  return (
    <View style={[tileStyle, style]} accessibilityElementsHidden importantForAccessibility="no">
      <Mark type={type} size={size} />
    </View>
  );
}

function Mark({ type, size }: { type: PaymentMethodType; size: number }) {
  const white = '#FFFFFF';
  const glyph = Math.round(size * 0.5);

  switch (type) {
    case 'gcash':
      return <Initial text="G" size={size} color={white} />;
    case 'maya':
      return <Initial text="M" size={size} color={white} />;
    case 'cash':
      return <Banknote size={glyph} color={white} strokeWidth={2.2} />;
    case 'wallet':
    default:
      return <Wallet size={glyph} color={white} strokeWidth={2.2} />;
  }
}

function Initial({ text, size, color }: { text: string; size: number; color: string }) {
  return (
    <Text
      allowFontScaling={false}
      style={{
        color,
        fontFamily: 'Quicksand_700Bold',
        fontSize: Math.round(size * 0.5),
        includeFontPadding: false,
        textAlign: 'center',
      }}
    >
      {text}
    </Text>
  );
}
