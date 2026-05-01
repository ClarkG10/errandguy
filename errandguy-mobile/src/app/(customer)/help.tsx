import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  MessageCircle,
} from 'lucide-react-native';
import { Card } from '../../components/ui/Card';
import { BackButton } from '../../components/ui/BackButton';

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

export default function CustomerHelpScreen() {
  const [expanded, setExpanded] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setExpanded((prev) => (prev === idx ? null : idx));
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-3 px-5 py-4">
        <BackButton fallbackHref="/(customer)/(tabs)/profile" />
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Help Center
        </Text>
      </View>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mb-2 ml-1">
          Frequently Asked
        </Text>

        <Card className="p-0 overflow-hidden">
          {FAQS.map((faq, idx) => {
            const isOpen = expanded === idx;
            return (
              <View key={idx}>
                <Pressable
                  onPress={() => toggle(idx)}
                  className="flex-row items-center px-4 py-4"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={faq.question}
                >
                  <Text className="flex-1 text-sm font-montserrat-semi text-textPrimary pr-3">
                    {faq.question}
                  </Text>
                  {isOpen ? (
                    <ChevronUp size={18} color="#64748B" />
                  ) : (
                    <ChevronDown size={18} color="#64748B" />
                  )}
                </Pressable>
                {isOpen && (
                  <View className="px-4 pb-4 -mt-1">
                    <Text className="text-[13px] font-montserrat text-textSecondary leading-5">
                      {faq.answer}
                    </Text>
                  </View>
                )}
                {idx < FAQS.length - 1 && (
                  <View className="h-px bg-divider mx-4" />
                )}
              </View>
            );
          })}
        </Card>

        <Text className="text-[11px] font-montserrat-semi text-textTertiary uppercase tracking-wider mt-6 mb-2 ml-1">
          Still need help?
        </Text>
        <Card className="p-0 overflow-hidden">
          <Pressable
            onPress={() =>
              Linking.openURL(
                'mailto:support@errandguy.ph?subject=ErrandGuy%20Support',
              )
            }
            className="flex-row items-center px-4 py-4"
            accessibilityRole="button"
            accessibilityLabel="Email support"
          >
            <Mail size={20} color="#475569" strokeWidth={1.8} />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-montserrat-semi text-textPrimary">
                Email Support
              </Text>
              <Text className="text-xs font-montserrat text-textTertiary">
                support@errandguy.ph
              </Text>
            </View>
          </Pressable>
          <View className="h-px bg-divider mx-4" />
          <Pressable
            onPress={() => Linking.openURL('tel:+639171234567')}
            className="flex-row items-center px-4 py-4"
            accessibilityRole="button"
            accessibilityLabel="Call support"
          >
            <Phone size={20} color="#475569" strokeWidth={1.8} />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-montserrat-semi text-textPrimary">
                Hotline
              </Text>
              <Text className="text-xs font-montserrat text-textTertiary">
                Mon–Sun, 8 AM – 10 PM
              </Text>
            </View>
          </Pressable>
          <View className="h-px bg-divider mx-4" />
          <Pressable
            onPress={() =>
              Linking.openURL(
                'mailto:support@errandguy.ph?subject=ErrandGuy%20Issue%20Report&body=Booking%20number%3A%20%0AIssue%3A%20',
              )
            }
            className="flex-row items-center px-4 py-4"
            accessibilityRole="button"
            accessibilityLabel="Report an issue"
          >
            <MessageCircle size={20} color="#475569" strokeWidth={1.8} />
            <View className="flex-1 ml-3">
              <Text className="text-sm font-montserrat-semi text-textPrimary">
                Report an Issue
              </Text>
              <Text className="text-xs font-montserrat text-textTertiary">
                We respond within one business day
              </Text>
            </View>
          </Pressable>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
