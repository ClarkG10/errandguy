import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Mail,
  Phone,
} from 'lucide-react-native';
import { Card } from '../../../components/ui/Card';

interface FAQ {
  question: string;
  answer: string;
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
  const [expanded, setExpanded] = useState<number | null>(null);

  const toggle = (idx: number) => {
    setExpanded((prev) => (prev === idx ? null : idx));
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">Help & Support</Text>
      </View>

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* FAQ Section */}
        <Text className="text-sm font-montserrat-bold text-textSecondary uppercase tracking-wider mb-3">
          Frequently Asked Questions
        </Text>

        <Card className="p-0 overflow-hidden mb-6">
          {FAQS.map((faq, idx) => (
            <View
              key={idx}
              className={idx < FAQS.length - 1 ? 'border-b border-divider' : ''}
            >
              <Pressable
                onPress={() => toggle(idx)}
                className="flex-row items-center justify-between p-4"
              >
                <Text className="text-sm font-montserrat-bold text-textPrimary flex-1 mr-3">
                  {faq.question}
                </Text>
                {expanded === idx ? (
                  <ChevronUp size={18} color="#94A3B8" />
                ) : (
                  <ChevronDown size={18} color="#94A3B8" />
                )}
              </Pressable>
              {expanded === idx && (
                <View className="px-4 pb-4">
                  <Text className="text-sm font-montserrat text-textSecondary leading-5">
                    {faq.answer}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </Card>

        {/* Contact Section */}
        <Text className="text-sm font-montserrat-bold text-textSecondary uppercase tracking-wider mb-3">
          Contact Us
        </Text>

        <Card className="p-0 overflow-hidden">
          <Pressable
            onPress={() => Linking.openURL('mailto:support@errandguy.app')}
            className="flex-row items-center gap-3 p-4 border-b border-divider"
          >
            <Mail size={20} color="#475569" />
            <View>
              <Text className="text-sm font-montserrat-bold text-textPrimary">Email Support</Text>
              <Text className="text-xs font-montserrat text-textSecondary">
                support@errandguy.app
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPress={() => Linking.openURL('tel:+639123456789')}
            className="flex-row items-center gap-3 p-4"
          >
            <Phone size={20} color="#475569" />
            <View>
              <Text className="text-sm font-montserrat-bold text-textPrimary">Phone Support</Text>
              <Text className="text-xs font-montserrat text-textSecondary">
                +63 912 345 6789
              </Text>
            </View>
          </Pressable>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
