import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Linking,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  Mail,
  Phone,
  Search,
  Headphones,
  X,
} from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Eyebrow } from '../../../components/ui/Typography';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { useResponsive } from '../../../constants/responsive';
import { LightColors } from '../../../constants/colors';
import { toast } from '../../../stores/toastStore';
import { useAuthStore } from '../../../stores/authStore';
import { prefetchSupportTickets } from '../../../services/preload.service';

// LayoutAnimation is opt-in on old-architecture Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Row pressed feedback: a surfaceMuted wash reads better than scale for
// rows inside a shared card (scale would shift the hairlines). Rows carry
// the card's inset so the wash bleeds edge-to-edge.
const rowPressed = ({ pressed }: { pressed: boolean }) =>
  pressed ? { backgroundColor: LightColors.surfaceMuted } : null;
const ROW_RIPPLE = { color: `${LightColors.primary}14` };

interface FAQ {
  question: string;
  answer: string;
}

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

const FAQS: FAQ[] = [
  {
    question: 'How do I receive errand requests?',
    answer:
      'Toggle yourself online from the dashboard. When a customer books an errand near your working area, you will receive a push notification with the details. Accept or decline within the time limit.',
  },
  {
    question: 'When do I get paid?',
    answer:
      'Earnings are credited to your in-app wallet once a customer confirms delivery. You can request a payout anytime from the Earnings tab.',
  },
  {
    question: 'How do I update my documents?',
    answer:
      'Go to Profile → Documents & Verification. Upload or re-upload any required document. Our team reviews submissions within 24-48 hours.',
  },
  {
    question: 'What if a customer cancels?',
    answer:
      'If the customer cancels after you have started the errand, you may receive a partial cancellation fee depending on the stage of the errand.',
  },
  {
    question: 'How is my rating calculated?',
    answer:
      'Your rating is the average of all customer reviews. Maintaining a rating above 4.0 keeps you eligible for priority errand assignments.',
  },
];

export default function HelpScreen() {
  const router = useRouter();
  // Key must match the Support screen's own ['support','tickets',userId].
  const userId = useAuthStore((st) => st.user?.id ?? 'anon');
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { contentMaxWidth } = useResponsive();
  // Track the expanded row by question (not list index) so the open row
  // stays correct while the search filter reshuffles indices.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filteredFaqs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return FAQS;
    return FAQS.filter(
      (faq) =>
        faq.question.toLowerCase().includes(q) || faq.answer.toLowerCase().includes(q),
    );
  }, [search]);

  const toggle = (question: string) => {
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
    setExpanded((prev) => (prev === question ? null : question));
  };

  const clearSearch = () => {
    Haptics.selectionAsync().catch(() => {});
    setSearch('');
  };

  const openLink = async (url: string, failMessage: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast.error(failMessage);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Help & Support" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          // Root is a plain View (GradientHeader insets only the top), so the
          // scroll floor must clear the home indicator itself — a flat 40 left
          // the last contact card grazing the gesture bar on inset devices.
          paddingBottom: insets.bottom + 40,
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* FAQ Section */}
        <Eyebrow className="mb-2">Frequently asked</Eyebrow>

        {/* Search — thin underline input, matching the history screen. */}
        <View className="flex-row items-center border-b border-divider pb-2 mb-3">
          <Search size={16} color={LightColors.textMuted} strokeWidth={1.6} />
          <TextInput
            className="flex-1 ml-2 text-[14px] font-montserrat text-textPrimary"
            placeholder="Search questions"
            placeholderTextColor={LightColors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search questions"
          />
          {/* iOS draws its own clearButtonMode X; render our own only
              elsewhere so the affordance isn't doubled up. */}
          {search.length > 0 && Platform.OS !== 'ios' && (
            <Pressable
              onPress={clearSearch}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              className="ml-1 p-1"
            >
              <X size={16} color={LightColors.textMuted} strokeWidth={2} />
            </Pressable>
          )}
        </View>

        <Card padding="none" className="overflow-hidden mb-6">
          {filteredFaqs.length === 0 ? (
            <View className="p-4">
              <Text className="text-sm font-montserrat text-textSecondary leading-5">
                No questions match “{search.trim()}”. Try a different keyword or contact us
                below.
              </Text>
            </View>
          ) : (
            filteredFaqs.map((faq, idx) => {
              const isExpanded = expanded === faq.question;
              return (
                <View
                  key={faq.question}
                  className={idx < filteredFaqs.length - 1 ? 'border-b border-divider' : ''}
                >
                  <Pressable
                    onPress={() => toggle(faq.question)}
                    style={rowPressed}
                    android_ripple={ROW_RIPPLE}
                    accessibilityRole="button"
                    accessibilityLabel={faq.question}
                    accessibilityState={{ expanded: isExpanded }}
                    className="flex-row items-center justify-between p-4"
                  >
                    <Text className="text-[14px] font-montserrat-semi text-textPrimary flex-1 mr-3">
                      {faq.question}
                    </Text>
                    <FaqChevron open={isExpanded} reduceMotion={reduceMotion} />
                  </Pressable>
                  {isExpanded && (
                    <View className="px-4 pb-4">
                      <Text className="text-sm font-montserrat text-textSecondary leading-5">
                        {faq.answer}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>

        {/* Contact Section */}
        <Eyebrow className="mb-2">Contact us</Eyebrow>

        <Card padding="none" className="overflow-hidden">
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              // Warm the inbox before navigating (see (customer)/help.tsx).
              prefetchSupportTickets(userId);
              // Support tickets live in the shared (customer) stack — a
              // single threaded-support surface for both roles.
              router.push('/(customer)/support');
            }}
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Chat with support"
            className="flex-row items-center gap-3 p-4 border-b border-divider"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
              <Headphones size={18} color={LightColors.primary} strokeWidth={1.8} />
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">Chat with Support</Text>
              <Text className="text-sm font-montserrat text-textSecondary">
                Open a ticket and message our team
              </Text>
            </View>
            <ChevronRight size={16} color={LightColors.textMuted} strokeWidth={1.8} />
          </Pressable>

          <Pressable
            onPress={() =>
              openLink('mailto:support@errandguyph.com', "Couldn't open your mail app.")
            }
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Email Support, support@errandguyph.com"
            className="flex-row items-center gap-3 p-4 border-b border-divider"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
              <Mail size={18} color={LightColors.primary} strokeWidth={1.8} />
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">Email Support</Text>
              <Text className="text-sm font-montserrat text-textSecondary">
                support@errandguyph.com
              </Text>
            </View>
            <ArrowUpRight size={16} color={LightColors.textMuted} strokeWidth={1.8} />
          </Pressable>

          <Pressable
            onPress={() => openLink('tel:+639123456789', "Couldn't open your phone app.")}
            style={rowPressed}
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Phone Support, +63 912 345 6789"
            className="flex-row items-center gap-3 p-4"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
              <Phone size={18} color={LightColors.primary} strokeWidth={1.8} />
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">Phone Support</Text>
              <Text
                className="text-sm font-inter text-textSecondary"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                +63 912 345 6789
              </Text>
            </View>
            <ArrowUpRight size={16} color={LightColors.textMuted} strokeWidth={1.8} />
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}
