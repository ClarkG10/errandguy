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
  Search,
  Headphones,
  X,
} from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Eyebrow } from '../../../components/ui/Typography';
import { PolicyLinksCard } from '../../../components/settings/PolicyLinksCard';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { useResponsive } from '../../../constants/responsive';
import { LightColors } from '../../../constants/colors';
import { toast } from '../../../stores/toastStore';
import { useAuthStore } from '../../../stores/authStore';
import { useRunnerStore } from '../../../stores/runnerStore';
import { offerAcceptSeconds, offerWindowPhrase } from '../../../utils/offerWindow';
import { prefetchSupportTickets } from '../../../services/preload.service';

// LayoutAnimation is opt-in on old-architecture Android.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Row pressed feedback: a surfaceMuted wash reads better than scale for
// rows inside a shared card (scale would shift the hairlines). Rows carry
// the card's inset so the wash bleeds edge-to-edge.
/** Next searches when one finds nothing (pattern 6). */
const FAQ_SUGGESTIONS = ['Payout', 'Documents', 'Rating'];
// Pressed fill rides on className (`active:bg-surfaceMuted`): a function
// `style` on a Pressable drops its className layout under NativeWind.
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
      <ChevronDown size={16} color={LightColors.textSecondary} strokeWidth={2} />
    </Animated.View>
  );
}

/**
 * The FAQ, with the offer window staff have set: "about 90 seconds" was
 * hard-coded here while the server reads matched_acceptance_timeout_seconds,
 * so a change in the admin panel left this page quoting the old figure.
 */
const runnerFaqs = (offerWindow: string): FAQ[] => [
  {
    question: 'How do I receive errand requests?',
    answer:
      `Go online from the dashboard. When a customer books an errand near you, it is offered to you directly and you have ${offerWindow} to accept or decline. With notifications on, offers keep reaching you for about 15 minutes after you lock your phone. If we get no location from you for 30 minutes, we switch you offline and let you know.`,
  },
  {
    question: 'When do I get paid?',
    answer:
      'Earnings are credited to your in-app wallet when the errand is completed. Request a payout from the Earnings tab; our team reviews each one and sends it to the GCash, Maya or bank account you saved, usually within 1–3 business days. On a cash errand you keep the cash you collect and the platform fee comes out of your wallet; anything you owe from cash errands is cleared automatically from your next prepaid earnings.',
  },
  {
    question: 'How do I update my documents?',
    answer:
      'Go to Profile → Documents & verification. Upload or re-upload any required document. Our team reviews submissions within 1–2 business days.',
  },
  {
    question: 'What if a customer cancels?',
    answer:
      'If a customer cancels after you accepted the errand and a cancellation fee applies, the fee goes to you — it lands in your wallet as a "Cancellation fee" and you can withdraw it with your next payout.',
  },
  {
    question: 'What if I can’t finish an errand?',
    answer:
      'Once you accept an errand it stays yours — you can’t hand it back in the app. If something stops you (the store is closed, the customer is unreachable, you’re in trouble), tap "Report a problem" on the errand and our team will reassign or cancel it. In an emergency use SOS or call 911.',
  },
  {
    question: 'How do I get offers?',
    answer:
      'Each offer goes to the nearest available runner whose vehicle suits the errand. Your rating doesn’t change which offers you get.',
  },
  {
    question: 'How is my rating calculated?',
    answer:
      'Your rating is the average of all customer reviews. Customers see it when you’re matched to their errand.',
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

  // The accept window rides the runner's own profile (offer_accept_seconds);
  // 90 seconds, the server default, until it has loaded.
  const offerSeconds = useRunnerStore((st) => offerAcceptSeconds(st.runnerProfile));
  const faqs = useMemo(() => runnerFaqs(offerWindowPhrase(offerSeconds)), [offerSeconds]);

  const filteredFaqs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return faqs;
    return faqs.filter(
      (faq) =>
        faq.question.toLowerCase().includes(q) || faq.answer.toLowerCase().includes(q),
    );
  }, [search, faqs]);

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
      <GradientHeader title="Help & support" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          // Gutter on the content, not the ScrollView: as a className it was
          // applied twice on web and pushed the column in to 40pt.
          paddingHorizontal: 20,
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
          <Search size={16} color={LightColors.textSecondary} strokeWidth={2} />
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
              <X size={16} color={LightColors.textSecondary} strokeWidth={2} />
            </Pressable>
          )}
        </View>

        <Card padding="none" className="overflow-hidden mb-6">
          {filteredFaqs.length === 0 ? (
            <View className="p-4">
              <Text className="text-sm font-montserrat text-textSecondary leading-5">
                No questions match “{search.trim()}”. Try one of these, or contact us below.
              </Text>
              <View className="flex-row flex-wrap mt-3" style={{ gap: 8 }}>
                {FAQ_SUGGESTIONS.filter(
                  (s) => s.toLowerCase() !== search.trim().toLowerCase(),
                ).map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setSearch(s)}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${s}`}
                    className="px-4 rounded-full border border-divider bg-surface items-center justify-center active:opacity-70"
                    style={{ minHeight: 44 }}
                  >
                    <Text className="text-[13px] font-montserrat-semi text-textPrimary">{s}</Text>
                  </Pressable>
                ))}
              </View>
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
                    android_ripple={ROW_RIPPLE}
                    accessibilityRole="button"
                    accessibilityLabel={faq.question}
                    accessibilityState={{ expanded: isExpanded }}
                    className="flex-row items-center justify-between p-4 active:bg-surfaceMuted"
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
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Chat with support"
            className="flex-row items-center gap-3 p-4 border-b border-divider active:bg-surfaceMuted"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
              <Headphones size={20} color={LightColors.primary} strokeWidth={1.8} />
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">Support tickets</Text>
              <Text className="text-sm font-montserrat text-textSecondary">
                Open a ticket and message our team
              </Text>
            </View>
            <ChevronRight size={16} color={LightColors.textSecondary} strokeWidth={1.8} />
          </Pressable>

          <Pressable
            onPress={() =>
              openLink('mailto:support@errandguyph.com', "Couldn't open your mail app.")
            }
            android_ripple={ROW_RIPPLE}
            accessibilityRole="button"
            accessibilityLabel="Email support, support@errandguyph.com"
            className="flex-row items-center gap-3 p-4 active:bg-surfaceMuted"
          >
            <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
              <Mail size={20} color={LightColors.primary} strokeWidth={1.8} />
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">Email support</Text>
              <Text className="text-sm font-montserrat text-textSecondary">
                support@errandguyph.com
              </Text>
            </View>
            <ArrowUpRight size={16} color={LightColors.textSecondary} strokeWidth={1.8} />
          </Pressable>
        </Card>

        <Eyebrow className="mt-6 mb-2">Policies</Eyebrow>
        <PolicyLinksCard />
      </ScrollView>
    </View>
  );
}
