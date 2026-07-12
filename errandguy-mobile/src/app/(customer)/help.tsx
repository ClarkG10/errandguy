import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Linking,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ChevronDown,
  Mail,
  Phone,
  MessageCircle,
  Headphones,
  ChevronRight,
  ArrowUpRight,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Card } from '../../components/ui/Card';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { Eyebrow, Hairline } from '../../components/ui/Typography';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';
import { toast } from '../../stores/toastStore';

// LayoutAnimation is opt-in on old-architecture Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Single source for the hotline so the visible number and the dialed
// number can never drift apart.
const SUPPORT_PHONE = '+63 917 123 4567';
const SUPPORT_PHONE_URL = `tel:${SUPPORT_PHONE.replace(/ /g, '')}`;

// Row pressed feedback: a surfaceMuted wash reads better than scale for
// rows inside a shared card (scale would shift the hairlines). Rows carry
// the card's horizontal inset so the wash bleeds edge-to-edge.
const rowPressed = ({ pressed }: { pressed: boolean }) =>
  pressed ? { backgroundColor: LightColors.surfaceMuted } : null;
const ROW_RIPPLE = { color: `${LightColors.primary}14` };

interface FAQ {
  question: string;
  answer: string;
}

const FAQS: FAQ[] = [
  {
    question: 'How do I book an errand?',
    answer:
      'Tap the errand type you need on the Home screen, set pickup and drop-off, add any details (notes, photos, recipient contact), then confirm. A nearby runner will be matched to you in real time.',
  },
  {
    question: 'How is the price calculated?',
    answer:
      'The fare = base fee + per-km distance fee + a small vehicle premium (motorcycle/car). Tipping is optional. For Negotiable errands you set your own offer; runners can accept or counter.',
  },
  {
    question: 'Can I track my runner live?',
    answer:
      'Yes. Once a runner accepts, the booking moves to the Track screen with a live map. You can also share a read-only trip link with a trusted contact.',
  },
  {
    question: 'How do I pay?',
    answer:
      'Cash on delivery, in-app wallet (Add Money), or any saved card. You can switch the payment method during booking. Refunds for cancelled errands return to your wallet.',
  },
  {
    question: 'What if my runner cancels or never arrives?',
    answer:
      'You will be re-matched automatically. If the system cannot find a runner within a few minutes, your booking is cancelled with no charge.',
  },
  {
    question: 'How do I report a safety issue?',
    answer:
      'Use the SOS button on the Track screen. For non-emergencies, tap "Report an Issue" below to email our support team with your booking number.',
  },
];

/** Single chevron that rotates 0→180° as the row opens (instant swap
 *  when the OS reduce-motion setting is on). */
function FaqChevron({ open, reduceMotion }: { open: boolean; reduceMotion: boolean }) {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [open, reduceMotion, progress]);

  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <ChevronDown size={16} color={LightColors.textTertiary} strokeWidth={2} />
    </Animated.View>
  );
}

export default function CustomerHelpScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { contentMaxWidth } = useResponsive();
  const [expanded, setExpanded] = useState<number | null>(0);

  const toggle = (idx: number) => {
    Haptics.selectionAsync().catch(() => {});
    if (!reduceMotion) {
      // Animates BOTH the opening row and the auto-collapsing sibling,
      // killing the double layout jump one-open-at-a-time causes.
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          200,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
    }
    setExpanded((prev) => (prev === idx ? null : idx));
  };

  // Linking.openURL rejects when no app can handle the scheme (no mail
  // client / dialer configured). Surface that instead of dying silently.
  const openMail = (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Linking.openURL(url).catch(() => {
      toast.error("Couldn't open your mail app.");
    });
  };

  const openPhone = (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Linking.openURL(url).catch(() => {
      toast.error("Couldn't open your phone app.");
    });
  };

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Help Center"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
      />

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 32,
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Eyebrow className="mb-2">Frequently asked</Eyebrow>

        <Card padding="none" className="py-1 overflow-hidden">
          {FAQS.map((faq, idx) => {
            const isOpen = expanded === idx;
            return (
              <View key={idx}>
                <Pressable
                  onPress={() => toggle(idx)}
                  className="flex-row items-center py-4 px-4"
                  style={rowPressed}
                  android_ripple={ROW_RIPPLE}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={faq.question}
                >
                  <Text className="flex-1 text-[14px] font-montserrat-semi text-textPrimary pr-3">
                    {faq.question}
                  </Text>
                  <FaqChevron open={isOpen} reduceMotion={reduceMotion} />
                </Pressable>
                {isOpen && (
                  <View className="px-4 pb-4 -mt-1">
                    <Text className="text-[13px] font-montserrat text-textSecondary leading-5">
                      {faq.answer}
                    </Text>
                  </View>
                )}
                {idx < FAQS.length - 1 && <Hairline />}
              </View>
            );
          })}
        </Card>

        <Eyebrow className="mt-8 mb-2">Still need help?</Eyebrow>
        <Card padding="none" className="py-1 overflow-hidden">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.push('/(customer)/support');
            }}
            className="flex-row items-center py-3 px-4"
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Chat with support"
            accessibilityHint="Opens a support ticket where you can message our team"
          >
            <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center">
              <Headphones size={18} color={LightColors.primary} strokeWidth={1.9} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Chat with support
              </Text>
              <Text className="text-[11px] font-montserrat text-textMuted">
                Open a ticket and message our team
              </Text>
            </View>
            <ChevronRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() =>
              openMail('mailto:support@errandguy.ph?subject=ErrandGuy%20Support')
            }
            className="flex-row items-center py-3 px-4"
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Email support"
            accessibilityHint="Opens your mail app addressed to support@errandguy.ph"
          >
            <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center">
              <Mail size={18} color={LightColors.primary} strokeWidth={1.9} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Email support
              </Text>
              <Text className="text-[11px] font-montserrat text-textMuted">
                support@errandguy.ph
              </Text>
            </View>
            <ArrowUpRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() => openPhone(SUPPORT_PHONE_URL)}
            className="flex-row items-center py-3 px-4"
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Call support hotline"
            accessibilityHint={`Calls ${SUPPORT_PHONE}, open 8 AM to 10 PM daily`}
          >
            <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center">
              <Phone size={18} color={LightColors.primary} strokeWidth={1.9} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Hotline
              </Text>
              <Text className="text-[11px] font-montserrat text-textMuted">
                <Text className="font-inter">{SUPPORT_PHONE}</Text> · 8 AM–10 PM daily
              </Text>
            </View>
            <ArrowUpRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() =>
              openMail(
                'mailto:support@errandguy.ph?subject=ErrandGuy%20Issue%20Report&body=Booking%20number%3A%20%0AIssue%3A%20',
              )
            }
            className="flex-row items-center py-3 px-4"
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Report an issue"
            accessibilityHint="Opens a pre-filled email; we respond within one business day"
          >
            <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center">
              <MessageCircle
                size={18}
                color={LightColors.primary}
                strokeWidth={1.9}
              />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Report an issue
              </Text>
              <Text className="text-[11px] font-montserrat text-textMuted">
                We respond within one business day
              </Text>
            </View>
            <ArrowUpRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}
