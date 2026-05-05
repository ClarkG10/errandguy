import React from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { ExternalLink } from 'lucide-react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Card } from '../../../components/ui/Card';

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
  const router = useRouter();

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Terms & Privacy" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <ScrollView
        className="flex-1 px-5"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {SECTIONS.map((section, idx) => (
          <View key={idx} className="mb-5">
            <Text className="text-sm font-montserrat-bold text-textPrimary mb-2">
              {section.title}
            </Text>
            <Card className="p-4">
              <Text className="text-sm font-montserrat text-textSecondary leading-5">
                {section.content}
              </Text>
            </Card>
          </View>
        ))}

        <Text className="text-xs font-montserrat text-textSecondary text-center mt-2">
          Last updated: January 2025
        </Text>
      </ScrollView>
    </View>
  );
}
