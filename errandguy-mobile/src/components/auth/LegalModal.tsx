import React from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { LightColors } from '../../constants/colors';

export type LegalDocument = 'terms' | 'privacy';

interface LegalModalProps {
  visible: boolean;
  document: LegalDocument;
  onClose: () => void;
  /** When provided, renders a sticky "Agree & continue" footer so reading
   *  the document flows straight into acceptance instead of dead-ending
   *  back at the checkbox. */
  onAgree?: () => void;
}

/**
 * Lightweight in-app viewer for the Terms of Service / Privacy Policy
 * placeholder copy referenced during sign-up. Mirrors the static-content
 * pattern of the runner Terms & Privacy screen (heading + text cards)
 * without leaving the registration flow.
 */
const CONTENT: Record<
  LegalDocument,
  { title: string; sections: { heading: string; body: string }[] }
> = {
  terms: {
    title: 'Terms of Service',
    sections: [
      {
        heading: 'Using ErrandGuy',
        body: `By creating an account you agree to use ErrandGuy honestly and lawfully. Runners on the platform are independent, verified individuals — not ErrandGuy employees. You are responsible for the accuracy of the errand details, addresses and contact information you provide.\n\nErrandGuy may suspend or terminate accounts that violate these terms, abuse runners or other users, or engage in fraudulent activity.`,
      },
      {
        heading: 'Bookings & Payments',
        body: `The fare or offer you confirm before booking is the amount you will be charged, plus any reconciled shopping costs you approve. Payments are processed securely through our payment partners; ErrandGuy never stores your full card details.\n\nCancellation fees may apply once a runner has been matched and is on the way.`,
      },
      {
        heading: 'Community Guidelines',
        body: `• Treat runners and other users with respect\n• Provide accurate errand details and safe meeting points\n• Do not request illegal, dangerous or prohibited items\n• Report any safety concerns immediately through the app`,
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        heading: 'What We Collect',
        body: `We collect the details you provide when you sign up (name, phone, email, profile photo) and, with your permission, your device location while you book and track errands. Saved addresses and trusted contacts are stored so you don't have to re-enter them.`,
      },
      {
        heading: 'How We Use It',
        body: `Your information is used to match you with nearby runners, provide real-time tracking, process payments and receipts, and keep your account secure. We never sell your personal information or share it with third parties for marketing.`,
      },
      {
        heading: 'Your Choices',
        body: `You can update your profile, manage permissions from your device settings, and request deletion of your data at any time using the Delete Account option in your profile or by contacting support.`,
      },
    ],
  },
};

export function LegalModal({ visible, document, onClose, onAgree }: LegalModalProps) {
  const doc = CONTENT[document];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      // Native iOS sheet: grabber + system swipe-down (which fires
      // onRequestClose). Ignored on Android, where the back button /
      // gesture already routes through onRequestClose.
      presentationStyle="pageSheet"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
          <Text className="text-[18px] font-montserrat-bold text-textPrimary flex-1 mr-3">
            {doc.title}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="w-10 h-10 rounded-full items-center justify-center bg-surfaceMuted"
          >
            <X size={20} color={LightColors.textPrimary} strokeWidth={2} />
          </Pressable>
        </View>

        <ScrollView
          className="flex-1 px-5"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {doc.sections.map((section, idx) => (
            <View key={idx} className="mb-5">
              <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
                {section.heading}
              </Text>
              <Card className="p-4">
                <Text className="text-sm font-montserrat text-textSecondary leading-5">
                  {section.body}
                </Text>
              </Card>
            </View>
          ))}

          <Text className="text-xs font-montserrat text-textSecondary text-center mt-2">
            Last updated: January 2026
          </Text>
        </ScrollView>

        {onAgree && (
          <View className="px-5 pt-3 pb-2 border-t border-divider bg-background">
            <Button title="Agree & continue" fullWidth size="md" onPress={onAgree} />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}
