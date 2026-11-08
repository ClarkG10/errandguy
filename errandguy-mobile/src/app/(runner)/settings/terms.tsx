import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Card } from '../../../components/ui/Card';
import { SectionHeader } from '../../../components/ui/Typography';
import { PublicPageLink } from '../../../components/settings/PublicPageLink';
import { useResponsive } from '../../../constants/responsive';
import type { PublicPage } from '../../../constants/legal';

/**
 * A short in-app summary; `links` open the published pages the API host
 * serves (constants/legal) — the full Terms, the full Privacy Policy, and the
 * account-deletion page.
 */
const SECTIONS: {
  title: string;
  content: string;
  links?: { page: PublicPage; label: string }[];
}[] = [
  {
    title: 'Terms of Service',
    content: `By using ErrandGuy as a Runner, you agree to these terms. You are an independent contractor, not an employee. You must maintain valid identification, comply with local traffic and delivery regulations, and provide honest, timely service to customers.\n\nPrices are fixed by ErrandGuy; your payout for each errand is shown before you accept. Once you accept an errand it stays yours — if you can't finish it, contact support and our team will reassign or cancel it. If a customer cancels after you accepted and a cancellation fee applies, the fee goes to you. Payouts are reviewed by our team and sent to the account you choose, usually within 1–3 business days.\n\nErrandGuy reserves the right to suspend or terminate accounts that violate community guidelines, receive consistently low ratings, or engage in fraudulent activity.`,
    links: [{ page: 'terms', label: 'Read the full Terms of Service' }],
  },
  {
    title: 'Privacy Policy',
    content: `We collect location data while you are online to match you with errands and provide real-time tracking to customers. Your personal information (name, phone, email, documents) is stored securely and never shared with third parties for marketing.\n\nYou can request deletion of your data at any time using the Delete Account option in your profile, on the web, or by contacting support. Any money left in your wallet is paid out to the GCash, Maya or bank account you choose.`,
    links: [
      { page: 'privacy', label: 'Read the full Privacy Policy' },
      { page: 'deleteAccount', label: 'Delete your account on the web' },
    ],
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
      <GradientHeader title="Terms & privacy" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          // Gutter on the content, not the ScrollView: as a className it was
          // applied twice on web and pushed the column in to 40pt.
          paddingHorizontal: 20,
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
              {section.links?.map((link) => (
                <PublicPageLink key={link.page} page={link.page} label={link.label} className="mt-3" />
              ))}
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
