import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import {
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  MessageCircle,
} from 'lucide-react-native';
import { Card } from '../../components/ui/Card';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { Hairline } from '../../components/ui/Typography';
import { LightColors } from '../../constants/colors';

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
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Help center"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
      />

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2"
          style={{ letterSpacing: 1.4 }}
        >
          Frequently asked
        </Text>

        <Card padding="none" className="px-4 py-1">
          {FAQS.map((faq, idx) => {
            const isOpen = expanded === idx;
            return (
              <View key={idx}>
                <Pressable
                  onPress={() => toggle(idx)}
                  className="flex-row items-center py-4"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={faq.question}
                >
                  <Text className="flex-1 text-[14px] font-montserrat-semi text-textPrimary pr-3">
                    {faq.question}
                  </Text>
                  {isOpen ? (
                    <ChevronUp
                      size={16}
                      color={LightColors.textMuted}
                      strokeWidth={1.6}
                    />
                  ) : (
                    <ChevronDown
                      size={16}
                      color={LightColors.textMuted}
                      strokeWidth={1.6}
                    />
                  )}
                </Pressable>
                {isOpen && (
                  <View className="pb-4 -mt-1">
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

        <Text
          className="text-[10px] font-montserrat-bold uppercase text-textSecondary mt-8 mb-2"
          style={{ letterSpacing: 1.4 }}
        >
          Still need help?
        </Text>
        <Card padding="none" className="px-4 py-1">
          <Pressable
            onPress={() =>
              Linking.openURL(
                'mailto:support@errandguy.ph?subject=ErrandGuy%20Support',
              )
            }
            className="flex-row items-center py-3"
            accessibilityRole="button"
            accessibilityLabel="Email support"
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
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() => Linking.openURL('tel:+639171234567')}
            className="flex-row items-center py-3"
            accessibilityRole="button"
            accessibilityLabel="Call support"
          >
            <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center">
              <Phone size={18} color={LightColors.primary} strokeWidth={1.9} />
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-[14px] font-montserrat-semi text-textPrimary">
                Hotline
              </Text>
              <Text className="text-[11px] font-montserrat text-textMuted">
                Mon–Sun, 8 AM – 10 PM
              </Text>
            </View>
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() =>
              Linking.openURL(
                'mailto:support@errandguy.ph?subject=ErrandGuy%20Issue%20Report&body=Booking%20number%3A%20%0AIssue%3A%20',
              )
            }
            className="flex-row items-center py-3"
            accessibilityRole="button"
            accessibilityLabel="Report an issue"
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
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}
