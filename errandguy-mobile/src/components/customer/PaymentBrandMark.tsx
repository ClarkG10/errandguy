import React from 'react';
import { View, Text, Image, type ViewStyle } from 'react-native';
import { CreditCard, Wallet, Banknote } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import type { PaymentMethodType } from '../../types';

/**
 * PaymentBrandMark — a brand-styled logo badge for each payment method.
 *
 * Replaces the old generic Lucide glyphs (a plain "phone" for both GCash
 * and Maya) with recognizable, brand-coloured marks so the payment sheet
 * reads like a real wallet picker:
 *
 *   • GCash / Maya / GrabPay — the provider's brand colour as a filled
 *     squircle with its wordmark initial in white. Instantly identifiable
 *     by colour even before the label is read.
 *   • Card — a neutral slate badge with a card glyph (network-agnostic).
 *   • Wallet — the ErrandGuy brand blue (it's our own balance).
 *   • Cash — money green with a banknote glyph.
 *
 * Drop-in official artwork later: put a PNG/SVG at
 * `assets/pay/<type>.png`, add it to `ART` below, and the badge renders
 * the real logo instead of the coloured initial with zero call-site
 * changes.
 */

type LetterMark = {
  kind: 'letter';
  /** Wordmark initial(s) rendered in white on the brand fill. */
  text: string;
  bg: string;
};
type IconMark = {
  kind: 'icon';
  Icon: LucideIcon;
  bg: string;
};
type Mark = LetterMark | IconMark;

// Brand colours (approximate official palettes — swap for exact hex once
// licensed artwork lands in `ART`).
const MARKS: Record<PaymentMethodType, Mark> = {
  gcash: { kind: 'letter', text: 'G', bg: '#0075F2' }, // GCash blue
  maya: { kind: 'letter', text: 'M', bg: '#12B76A' }, // Maya green
  grabpay: { kind: 'letter', text: 'G', bg: '#00B14F' }, // Grab green
  card: { kind: 'icon', Icon: CreditCard, bg: '#334155' }, // neutral slate
  wallet: { kind: 'icon', Icon: Wallet, bg: LightColors.primary }, // brand blue
  cash: { kind: 'icon', Icon: Banknote, bg: '#16A34A' }, // money green
};

// Optional real artwork. Add `gcash: require('../../../assets/pay/gcash.png')`
// here to override the coloured initial with the official logo.
const ART: Partial<Record<PaymentMethodType, number>> = {};

interface PaymentBrandMarkProps {
  type: PaymentMethodType;
  size?: number;
  style?: ViewStyle;
}

export function PaymentBrandMark({ type, size = 40, style }: PaymentBrandMarkProps) {
  const mark = MARKS[type] ?? MARKS.card;
  // Squircle radius — softer than a full circle so the coloured fill reads
  // as a logo tile rather than a status dot.
  const radius = Math.round(size * 0.28);
  const art = ART[type];

  if (art) {
    return (
      <View
        style={[
          { width: size, height: size, borderRadius: radius, overflow: 'hidden' },
          style,
        ]}
      >
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
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: mark.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {mark.kind === 'letter' ? (
        <Text
          allowFontScaling={false}
          style={{
            color: '#FFFFFF',
            fontFamily: 'Quicksand_700Bold',
            fontSize: Math.round(size * 0.5),
            includeFontPadding: false,
            textAlign: 'center',
          }}
        >
          {mark.text}
        </Text>
      ) : (
        <mark.Icon size={Math.round(size * 0.5)} color="#FFFFFF" strokeWidth={2.2} />
      )}
    </View>
  );
}
