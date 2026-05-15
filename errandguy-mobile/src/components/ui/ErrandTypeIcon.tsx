import React from 'react';
import { View, Image, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

export type ErrandIconName =
  | 'Package'
  | 'ShoppingCart'
  | 'UtensilsCrossed'
  | 'FileText'
  | 'Shirt'
  | 'Car'
  | 'Receipt'
  | 'Users'
  | 'ShoppingBag'
  | 'Clipboard'
  | 'PenTool';

type Variant = 'solid' | 'tinted' | 'ghost';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface ErrandTypeIconProps {
  name?: string | null;
  variant?: Variant;
  size?: Size;
  color?: string;
  style?: ViewStyle;
}

interface Palette {
  ink: string;
  primary: string;
  soft: string;
  wash: string;
  line: string;
  paper: string;
  shadow: string;
  accent: string;
}

interface IllustrationProps {
  size: number;
  palette: Palette;
}

const SIZE_MAP: Record<Size, number> = {
  xs: 34,
  sm: 46,
  md: 62,
  lg: 84,
  xl: 108,
};

const ASSET_ART: Partial<Record<ErrandIconName, number>> = {
  Package: require('../../../assets/delivery.png'),
  ShoppingCart: require('../../../assets/grocery-shopping.png'),
  UtensilsCrossed: require('../../../assets/food-pickup.png'),
  FileText: require('../../../assets/document-delivery.png'),
  Shirt: require('../../../assets/laundry.png'),
  Car: require('../../../assets/transportation.png'),
  Receipt: require('../../../assets/bills-payment.png'),
  Users: require('../../../assets/queue-or-line.png'),
  ShoppingBag: require('../../../assets/purchase-and-deliver.png'),
  PenTool: require('../../../assets/custom-errand.png'),
};

const VARIANT_PALETTE: Record<Variant, Palette> = {
  solid: {
    ink: '#0F172A',
    primary: '#2563EB',
    soft: '#93C5FD',
    wash: '#DBEAFE',
    line: '#BFDBFE',
    paper: '#FFFFFF',
    shadow: 'rgba(37,99,235,0.18)',
    accent: '#F59E0B',
  },
  tinted: {
    ink: '#1E293B',
    primary: '#2563EB',
    soft: '#BFDBFE',
    wash: '#EFF6FF',
    line: '#DBEAFE',
    paper: '#FFFFFF',
    shadow: 'rgba(15,23,42,0.09)',
    accent: '#F59E0B',
  },
  ghost: {
    ink: '#FFFFFF',
    primary: '#FFFFFF',
    soft: 'rgba(255,255,255,0.62)',
    wash: 'rgba(255,255,255,0.18)',
    line: 'rgba(255,255,255,0.45)',
    paper: 'rgba(255,255,255,0.96)',
    shadow: 'rgba(255,255,255,0.16)',
    accent: '#FBBF24',
  },
};

export function ErrandTypeIcon({
  name,
  variant = 'tinted',
  size = 'md',
  color,
  style,
}: ErrandTypeIconProps) {
  const resolvedSize = SIZE_MAP[size];
  const assetSource = ASSET_ART[(name as ErrandIconName) ?? 'Package'] ?? null;
  const palette = {
    ...VARIANT_PALETTE[variant],
    ...(color ? { primary: color } : null),
  } as Palette;
  const Illustration = ILLUSTRATIONS[(name as ErrandIconName) ?? 'Package'] ?? ILLUSTRATIONS.Package;

  if (assetSource) {
    return (
      <View style={[{ width: resolvedSize, height: resolvedSize }, style]}>
        <Image
          source={assetSource}
          style={{ width: resolvedSize, height: resolvedSize }}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={[{ width: resolvedSize, height: resolvedSize }, style]}>
      <Illustration size={resolvedSize} palette={palette} />
    </View>
  );
}

function Scene({ size, palette, children }: React.PropsWithChildren<IllustrationProps>) {
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128" fill="none">
      <Circle cx="64" cy="63" r="52" fill={palette.wash} />
      <Circle cx="36" cy="38" r="9" fill={palette.soft} opacity="0.55" />
      <Circle cx="99" cy="40" r="6" fill={palette.line} opacity="0.72" />
      <Circle cx="104" cy="84" r="5" fill={palette.soft} opacity="0.42" />
      <Ellipse cx="64" cy="107" rx="36" ry="8" fill={palette.shadow} />
      <Rect x="24" y="27" width="80" height="67" rx="24" fill={palette.paper} opacity="0.96" />
      <Path d="M32 79c17-18 30 10 49-8 7-7 13-9 20-8" stroke={palette.line} strokeWidth="4" strokeLinecap="round" strokeDasharray="1 10" opacity="0.9" />
      {children}
    </Svg>
  );
}

function MiniText({ x, y, width, palette }: { x: number; y: number; width: number; palette: Palette }) {
  return (
    <>
      <Rect x={x} y={y} width={width} height="4.8" rx="2.4" fill={palette.primary} opacity="0.9" />
      <Rect x={x} y={y + 8} width={width * 0.68} height="4" rx="2" fill={palette.line} />
    </>
  );
}

function PackageArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Path d="M35 58 63 44l30 14-30 15-28-15Z" fill={palette.soft} stroke={palette.ink} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M35 58v27l28 16V73L35 58Z" fill={palette.primary} stroke={palette.ink} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M93 58v27l-30 16V73l30-15Z" fill={palette.wash} stroke={palette.ink} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M63 44v29" stroke={palette.ink} strokeWidth="3" strokeLinecap="round" />
      <Rect x="80" y="35" width="21" height="17" rx="6" fill={palette.paper} stroke={palette.line} strokeWidth="2" />
      <Circle cx="88" cy="43" r="3" fill={palette.primary} />
      <MiniText x={30} y={34} width={24} palette={palette} />
    </Scene>
  );
}

function ShoppingCartArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Rect x="31" y="47" width="66" height="30" rx="13" fill={palette.wash} />
      <Path d="M28 45h10l6 35h42l8-25H47" stroke={palette.ink} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="55" cy="91" r="6" fill={palette.primary} stroke={palette.ink} strokeWidth="3" />
      <Circle cx="82" cy="91" r="6" fill={palette.primary} stroke={palette.ink} strokeWidth="3" />
      <Circle cx="56" cy="50" r="7" fill="#86EFAC" />
      <Circle cx="69" cy="46" r="6" fill="#FBBF24" />
      <Circle cx="82" cy="52" r="6" fill="#F87171" />
      <Rect x="90" y="33" width="17" height="26" rx="7" fill={palette.paper} stroke={palette.line} strokeWidth="2" />
      <MiniText x={31} y={33} width={28} palette={palette} />
    </Scene>
  );
}

function MealArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Path d="M35 82h49" stroke={palette.ink} strokeWidth="4" strokeLinecap="round" />
      <Path d="M43 82c3-20 15-32 25-32s21 12 24 32" fill={palette.wash} stroke={palette.ink} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M53 43c0-7 4-11 9-16M66 43c0-6 3-10 8-14" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <Rect x="87" y="51" width="18" height="35" rx="7" fill={palette.paper} stroke={palette.line} strokeWidth="2" />
      <Path d="M93 51v-8a5 5 0 0 1 10 0v8" stroke={palette.ink} strokeWidth="2.4" strokeLinecap="round" />
      <Circle cx="93" cy="93" r="6" fill={palette.accent} />
      <MiniText x={31} y={34} width={26} palette={palette} />
    </Scene>
  );
}

function DocumentArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Path d="M39 35h36l17 17v43a8 8 0 0 1-8 8H39a8 8 0 0 1-8-8V43a8 8 0 0 1 8-8Z" fill={palette.paper} stroke={palette.line} strokeWidth="3" />
      <Path d="M75 35v18h17" stroke={palette.ink} strokeWidth="3" strokeLinejoin="round" />
      <Rect x="45" y="61" width="32" height="6" rx="3" fill={palette.primary} />
      <Rect x="45" y="75" width="36" height="5" rx="2.5" fill={palette.line} />
      <Rect x="45" y="88" width="22" height="5" rx="2.5" fill={palette.primary} opacity="0.78" />
      <Rect x="86" y="67" width="22" height="28" rx="8" fill={palette.wash} stroke={palette.line} strokeWidth="2" />
      <Path d="M92 81h10" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <Circle cx="99" cy="45" r="6" fill="#22C55E" />
    </Scene>
  );
}

function ShirtArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Circle cx="37" cy="87" r="15" fill={palette.wash} stroke={palette.line} strokeWidth="2" />
      <Path d="M50 36 29 50l10 21 14-7v41h32V64l14 7 10-21-21-14-11 10H61L50 36Z" fill={palette.paper} stroke={palette.ink} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M63 47c3 3 6 4 8 4s5-1 8-4" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <Path d="M71 52v52" stroke={palette.line} strokeWidth="2.4" strokeLinecap="round" />
      <Path d="M28 87h18" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <Circle cx="98" cy="36" r="7" fill={palette.accent} />
    </Scene>
  );
}

function CarArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Path d="M30 93c19-23 37 12 59-10 8-8 14-10 22-9" stroke={palette.primary} strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" opacity="0.72" />
      <Path d="M34 73h60l-6-21a8 8 0 0 0-8-6H54a8 8 0 0 0-8 6l-6 21Z" fill={palette.paper} stroke={palette.line} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M30 73h70v15a7 7 0 0 1-7 7h-6v-8H43v8h-6a7 7 0 0 1-7-7V73Z" fill={palette.wash} stroke={palette.ink} strokeWidth="3" strokeLinejoin="round" />
      <Circle cx="47" cy="83" r="6" fill={palette.primary} />
      <Circle cx="83" cy="83" r="6" fill={palette.primary} />
      <Path d="M51 59h33" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <Path d="M86 38c0-10 8-17 18-17s18 7 18 17c0 14-18 28-18 28S86 52 86 38Z" fill={palette.soft} />
      <Circle cx="104" cy="38" r="5" fill={palette.paper} />
    </Scene>
  );
}

function ReceiptArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Path d="M39 34h40v70l-6-4-6 4-6-4-6 4-6-4-10 4V34Z" fill={palette.paper} stroke={palette.line} strokeWidth="3" strokeLinejoin="round" />
      <Rect x="50" y="50" width="22" height="6" rx="3" fill={palette.primary} />
      <Rect x="50" y="64" width="22" height="6" rx="3" fill={palette.line} />
      <Rect x="50" y="78" width="15" height="6" rx="3" fill={palette.primary} opacity="0.82" />
      <Rect x="82" y="63" width="26" height="35" rx="9" fill={palette.wash} stroke={palette.line} strokeWidth="2" />
      <Circle cx="95" cy="81" r="7" fill={palette.accent} />
      <Path d="M89 81h12" stroke={palette.paper} strokeWidth="3" strokeLinecap="round" />
    </Scene>
  );
}

function PeopleArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Circle cx="52" cy="55" r="13" fill={palette.paper} stroke={palette.line} strokeWidth="3" />
      <Circle cx="85" cy="56" r="11" fill={palette.wash} stroke={palette.line} strokeWidth="3" />
      <Path d="M31 99c3-17 15-27 27-27s24 10 27 27" fill={palette.paper} stroke={palette.line} strokeWidth="3" strokeLinecap="round" />
      <Path d="M80 98c2-11 10-17 18-18 7-1 13 3 17 9" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <Rect x="60" y="70" width="18" height="17" rx="6" fill={palette.wash} stroke={palette.line} strokeWidth="2" />
      <Path d="M66 78h8" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <Circle cx="97" cy="36" r="6" fill="#22C55E" />
    </Scene>
  );
}

function BagArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Path d="M43 51h57l-5 47a10 10 0 0 1-10 9H55a10 10 0 0 1-10-9l-2-47Z" fill={palette.paper} stroke={palette.line} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M56 51v-9a15 15 0 0 1 30 0v9" stroke={palette.ink} strokeWidth="3" strokeLinecap="round" />
      <Circle cx="63" cy="75" r="7" fill="#86EFAC" />
      <Circle cx="80" cy="78" r="6" fill="#FBBF24" />
      <Rect x="29" y="36" width="29" height="23" rx="9" fill={palette.wash} stroke={palette.line} strokeWidth="2" />
      <Path d="M38 48h11" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <MiniText x={32} y={87} width={26} palette={palette} />
    </Scene>
  );
}

function ClipboardArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Rect x="39" y="36" width="58" height="75" rx="14" fill={palette.paper} stroke={palette.line} strokeWidth="3" />
      <Rect x="56" y="28" width="26" height="16" rx="6" fill={palette.wash} stroke={palette.line} strokeWidth="2" />
      <Path d="M59 61h26M59 77h26M59 93h16" stroke={palette.primary} strokeWidth="3" strokeLinecap="round" />
      <Path d="M48 61l3 3 6-7M48 77l3 3 6-7" stroke={palette.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="86" y="82" width="22" height="25" rx="8" fill={palette.wash} stroke={palette.line} strokeWidth="2" />
      <Circle cx="97" cy="94" r="5" fill={palette.accent} />
    </Scene>
  );
}

function PenToolArt({ size, palette }: IllustrationProps) {
  return (
    <Scene size={size} palette={palette}>
      <Rect x="31" y="82" width="42" height="25" rx="9" fill={palette.paper} stroke={palette.line} strokeWidth="3" />
      <Path d="M87 34 109 56 72 93 48 101l8-24 31-43Z" fill={palette.wash} stroke={palette.line} strokeWidth="3" strokeLinejoin="round" />
      <Path d="M81 41 103 63" stroke={palette.primary} strokeWidth="4" strokeLinecap="round" />
      <Path d="M48 101l24-8-16-16-8 24Z" fill={palette.primary} opacity="0.86" />
      <Rect x="40" y="90" width="24" height="5" rx="2.5" fill={palette.primary} />
      <Rect x="40" y="98" width="14" height="5" rx="2.5" fill={palette.line} />
      <Circle cx="106" cy="36" r="6" fill="#FBBF24" />
    </Scene>
  );
}

const ILLUSTRATIONS: Record<ErrandIconName, React.FC<IllustrationProps>> = {
  Package: PackageArt,
  ShoppingCart: ShoppingCartArt,
  UtensilsCrossed: MealArt,
  FileText: DocumentArt,
  Shirt: ShirtArt,
  Car: CarArt,
  Receipt: ReceiptArt,
  Users: PeopleArt,
  ShoppingBag: BagArt,
  Clipboard: ClipboardArt,
  PenTool: PenToolArt,
};
