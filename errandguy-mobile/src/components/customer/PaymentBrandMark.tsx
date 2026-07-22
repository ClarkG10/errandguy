import React from 'react';
import { View, Text, Image, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, ClipPath } from 'react-native-svg';
import { CreditCard, Wallet, Banknote } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import type { PaymentMethodType } from '../../types';

/**
 * PaymentBrandMark — a brand-accurate logo badge for each payment method.
 *
 * Renders recognizable, brand-coloured marks so the payment sheet reads like a
 * real wallet picker instead of a row of generic phone/card glyphs:
 *
 *   • GCash / Maya / GrabPay — the provider's OFFICIAL brand colour as a filled
 *     tile with its wordmark initial in white (blue "G", emerald "M", green
 *     "G" — disambiguated by colour).
 *   • Visa / Mastercard / Amex — the real network marks (Mastercard's two
 *     interlocking circles; VISA / AMEX wordmark tiles) so a saved card shows
 *     its actual network. Pass `brand` (from PaymentMethod.card_brand).
 *   • Card (network unknown) — a neutral slate card glyph.
 *   • Wallet — ErrandGuy brand blue (our own balance); Cash — money green.
 *
 * These are simplified, non-proprietary identifying marks built from official
 * brand COLOURS + plain wordmarks/geometric forms. To use fully-licensed
 * official artwork, drop a file at `assets/pay/<key>.png` and add it to `ART`
 * below (keys: gcash | maya | grabpay | visa | mastercard | amex | card |
 * wallet | cash) — the badge then renders the real logo with zero call-site
 * changes.
 */

// A "logo key" is the payment type, refined to a card network when known.
type LogoKey =
  | 'gcash'
  | 'maya'
  | 'grabpay'
  | 'card'
  | 'wallet'
  | 'cash'
  | 'visa'
  | 'mastercard'
  | 'amex';

// Official brand colours (verified): GCash #007CFF, Grab #00B14F (PMS 355C),
// Maya vivid emerald, Visa navy #1A1F71, Mastercard red/orange/yellow,
// Amex blue. E-wallet tiles use the brand fill; card networks sit on a light
// tile so their coloured marks read correctly.
const TILE_BG: Record<LogoKey, string> = {
  gcash: '#007CFF',
  maya: '#10C98E',
  grabpay: '#00B14F',
  card: '#334155',
  wallet: LightColors.primary,
  cash: '#16A34A',
  visa: '#FFFFFF',
  mastercard: '#FFFFFF',
  amex: '#1F72CF',
};

// Light tiles need a hairline so they don't vanish on a white surface.
const LIGHT_TILE: Partial<Record<LogoKey, boolean>> = { visa: true, mastercard: true };

// Optional real artwork override. Add e.g.
// `gcash: require('../../../assets/pay/gcash.png')` to render the official logo
// instead of the vector mark.
const ART: Partial<Record<LogoKey, number>> = {};

/** Map a stored card_brand string to a known network logo key. */
function cardBrandToKey(brand?: string | null): LogoKey {
  const b = (brand ?? '').toLowerCase();
  if (b.includes('visa')) return 'visa';
  if (b.includes('master')) return 'mastercard';
  if (b.includes('amex') || b.includes('american')) return 'amex';
  return 'card';
}

function resolveKey(type: PaymentMethodType, brand?: string | null): LogoKey {
  if (type === 'card') return cardBrandToKey(brand);
  return type;
}

interface PaymentBrandMarkProps {
  type: PaymentMethodType;
  /** Card network for a saved card (e.g. 'visa', 'mastercard'). */
  brand?: string | null;
  size?: number;
  style?: ViewStyle;
}

export function PaymentBrandMark({ type, brand, size = 40, style }: PaymentBrandMarkProps) {
  const key = resolveKey(type, brand);
  const radius = Math.round(size * 0.28); // squircle — reads as a logo tile
  const bg = TILE_BG[key] ?? TILE_BG.card;
  const art = ART[key];

  const tileStyle: ViewStyle = {
    width: size,
    height: size,
    borderRadius: radius,
    backgroundColor: bg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...(LIGHT_TILE[key]
      ? { borderWidth: 1, borderColor: LightColors.divider }
      : null),
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
      <Mark logoKey={key} size={size} />
    </View>
  );
}

function Mark({ logoKey, size }: { logoKey: LogoKey; size: number }) {
  const white = '#FFFFFF';

  switch (logoKey) {
    case 'gcash':
      return <Initial text="G" size={size} color={white} />;
    case 'maya':
      return <Initial text="M" size={size} color={white} />;
    case 'grabpay':
      return <Initial text="G" size={size} color={white} />;

    case 'visa':
      return <Wordmark text="VISA" size={size} color="#1A1F71" italic />;
    case 'amex':
      return <Wordmark text="AMEX" size={size} color={white} />;
    case 'mastercard':
      return <MastercardMark size={size} />;

    case 'wallet':
      return <Wallet size={Math.round(size * 0.5)} color={white} strokeWidth={2.2} />;
    case 'cash':
      return <Banknote size={Math.round(size * 0.5)} color={white} strokeWidth={2.2} />;
    case 'card':
    default:
      return <CreditCard size={Math.round(size * 0.5)} color={white} strokeWidth={2.2} />;
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

function Wordmark({
  text,
  size,
  color,
  italic,
}: {
  text: string;
  size: number;
  color: string;
  italic?: boolean;
}) {
  return (
    <Text
      allowFontScaling={false}
      style={{
        color,
        fontFamily: 'Quicksand_700Bold',
        fontSize: Math.round(size * 0.26),
        letterSpacing: Math.max(0.5, size * 0.02),
        fontStyle: italic ? 'italic' : 'normal',
        includeFontPadding: false,
        textAlign: 'center',
      }}
    >
      {text}
    </Text>
  );
}

/**
 * Mastercard's interlocking two-circle mark: a red circle and a yellow circle
 * whose overlap reads orange. The orange lens is the TRUE intersection — the
 * right circle clipped to the left circle — so the two colours stay balanced
 * (not yellow-over-red). A simple geometric/functional mark. The clip id is
 * per-instance so two Mastercard marks on one screen don't collide.
 */
function MastercardMark({ size }: { size: number }) {
  const clipId = 'mc-' + React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const d = Math.round(size * 0.66); // mark footprint within the tile
  return (
    <Svg width={d} height={d} viewBox="0 0 48 32">
      <Defs>
        <ClipPath id={clipId}>
          <Circle cx={18} cy={16} r={14} />
        </ClipPath>
      </Defs>
      <Circle cx={18} cy={16} r={14} fill="#EB001B" />
      <Circle cx={30} cy={16} r={14} fill="#F79E1B" />
      <Circle cx={30} cy={16} r={14} fill="#FF5F00" clipPath={`url(#${clipId})`} />
    </Svg>
  );
}
