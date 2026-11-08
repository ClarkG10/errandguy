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
  MessageCircle,
  Headphones,
  ChevronRight,
  ArrowUpRight,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Card } from '../../components/ui/Card';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { Eyebrow, Hairline } from '../../components/ui/Typography';
import { PolicyLinksCard } from '../../components/settings/PolicyLinksCard';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';
import { toast } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { prefetchSupportTickets } from '../../services/preload.service';

// LayoutAnimation is opt-in on old-architecture Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
      'Tap the errand type you need on the Home screen, set pickup and drop-off, add any details (notes, photos, recipient contact), then confirm. We offer it to the nearest available runner. If you pay with GCash or Maya, we start looking once your payment goes through.',
  },
  {
    question: 'How is the price calculated?',
    answer:
      'The fare = base fee + per-km distance fee + a small vehicle premium (motorcycle/car). Every price is fixed: you see the full fare before you confirm, and a runner can only accept it — no bidding, no counter-offers. For a Buy-for-me errand you also repay the item cost in cash to the runner at the door, as shown on the receipt. Tipping is optional.',
  },
  {
    question: 'Can I track my runner live?',
    answer:
      'Yes. Once a runner accepts, the errand moves to the Track screen with a live map, the runner’s vehicle and plate. You can also share a read-only trip link with a trusted contact.',
  },
  {
    question: 'How do I pay?',
    answer:
      'Cash, GCash or Maya (you approve the payment in their app), or your ErrandGuy wallet balance. You choose on the review screen before you confirm — we don’t save cards. Refunds go to your wallet, and you can ask to withdraw your balance to GCash or Maya from the Wallet screen; our team reviews and sends withdrawals, usually within 1–3 business days.',
  },
  {
    question: 'What if I cancel?',
    answer:
      'Cancelling is free until a runner accepts. After that a small cancellation fee may apply — the app shows it before you confirm, and the fee goes to the runner who accepted. Anything you prepaid beyond the fee comes back to your wallet. Once your runner has arrived or started, the errand can’t be cancelled in the app — contact support instead.',
  },
  {
    question: 'What if my runner can’t finish or stops responding?',
    answer:
      'Once a runner accepts, the errand stays theirs — runners can’t hand it back. If something goes wrong, tap "Report a problem" on the errand and our team can reassign it to another runner or cancel it. If no runner accepts your errand at all, it is cancelled with no charge and anything you paid returns to your wallet.',
  },
  {
    question: 'How do I report a safety issue?',
    answer:
      'In immediate danger, call 911. The SOS button on the Track screen alerts the ErrandGuy safety team — the screen then tells you exactly who was alerted. For anything else, use "Report a problem" or "Report this person" on the errand to open a ticket our team will answer in Support.',
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
  // Key must match the Support screen's own ['support','tickets',userId].
  const userId = useAuthStore((st) => st.user?.id ?? 'anon');
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

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Help & support"
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
              // Warm the inbox before navigating — the one screen someone
              // opens because something is already wrong shouldn't spin.
              prefetchSupportTickets(userId);
              router.push('/(customer)/support');
            }}
            className="flex-row items-center py-3 px-4"
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Chat with support"
            accessibilityHint="Opens a support ticket where you can message our team"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
              <Headphones size={18} color={LightColors.primary} strokeWidth={1.9} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Chat with support
              </Text>
              <Text className="text-[11px] font-montserrat text-textTertiary">
                Open a ticket and message our team
              </Text>
            </View>
            <ChevronRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() =>
              openMail('mailto:support@errandguyph.com?subject=ErrandGuy%20Support')
            }
            className="flex-row items-center py-3 px-4"
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Email support"
            accessibilityHint="Opens your mail app addressed to support@errandguyph.com"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
              <Mail size={18} color={LightColors.primary} strokeWidth={1.9} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Email support
              </Text>
              <Text className="text-[11px] font-montserrat text-textTertiary">
                support@errandguyph.com
              </Text>
            </View>
            <ArrowUpRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() =>
              openMail(
                'mailto:support@errandguyph.com?subject=ErrandGuy%20Issue%20Report&body=Booking%20number%3A%20%0AIssue%3A%20',
              )
            }
            className="flex-row items-center py-3 px-4"
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Report an issue by email"
            accessibilityHint="Opens a pre-filled email to support@errandguyph.com"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
              <MessageCircle
                size={18}
                color={LightColors.primary}
                strokeWidth={1.9}
              />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Report an issue by email
              </Text>
              <Text className="text-[11px] font-montserrat text-textTertiary">
                Include your booking number
              </Text>
            </View>
            <ArrowUpRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
          </Pressable>
        </Card>

        <Eyebrow className="mt-8 mb-2">Policies</Eyebrow>
        <PolicyLinksCard />
      </ScrollView>
    </View>
  );
}
