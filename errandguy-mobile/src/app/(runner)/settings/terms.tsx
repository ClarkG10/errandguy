import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Card } from '../../../components/ui/Card';
import { SectionHeader } from '../../../components/ui/Typography';
import { useResponsive } from '../../../constants/responsive';

const SECTIONS = [
  {
    title: 'Terms of Service',
    content: `By using ErrandGuy as a Runner, you agree to these terms. You are an independent contractor, not an employee. You must maintain valid identification, comply with local traffic and delivery regulations, and provide honest, timely service to customers.\n\nErrandGuy reserves the right to suspend or terminate accounts that violate community guidelines, receive consistently low ratings, or engage in fraudulent activity.`,
  },
  {
    title: 'Privacy Policy',
    content: `We collect location data while you are online to match you with errands and provide real-time tracking to customers. Your personal information (name, phone, email, documents) is stored securely and never shared with third parties for marketing.\n\nYou can request deletion of your data at any time by contacting support or using the Delete Account option in your profile.`,
  },
  {
    title: 'Community Guidelines',
    content: `• Treat customers and other runners with respect\n• Complete errands in a timely manner\n• Do not misrepresent items or delivery status\n• Follow safe driving and delivery practices\n• Report any safety concerns immediately\n• Maintain a professional appearance and demeanor`,
  },
];

export default function TermsScreen() {
  const { contentMaxWidth } = useResponsive();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Terms & Privacy" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + 40,
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {SECTIONS.map((section, idx) => (
          <View key={idx} className="mb-6">
            <SectionHeader title={section.title} />
            <Card className="p-4">
              {/* 14px on a 22px lead (~1.57) keeps dense legal copy
                  comfortably readable on low-end Android. */}
              <Text className="text-[14px] font-montserrat text-textSecondary leading-[22px]">
                {section.content}
              </Text>
            </Card>
          </View>
        ))}

        <Text className="text-xs font-montserrat text-textSecondary text-center mt-1">
          Last updated: January 2025
        </Text>
      </ScrollView>
    </View>
  );
}
