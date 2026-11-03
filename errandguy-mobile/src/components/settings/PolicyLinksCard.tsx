import React from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ArrowUpRight, FileText, ShieldCheck, UserX, type LucideIcon } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { Hairline } from '../ui/Typography';
import { LightColors } from '../../constants/colors';
import { PUBLIC_PAGES, type PublicPage } from '../../constants/legal';
import { openPublicPage } from './PublicPageLink';

const ROWS: { page: PublicPage; icon: LucideIcon; label: string; caption: string }[] = [
  { page: 'terms', icon: FileText, label: 'Terms of Service', caption: 'The rules for using ErrandGuy' },
  { page: 'privacy', icon: ShieldCheck, label: 'Privacy Policy', caption: 'What we collect and why' },
  {
    page: 'deleteAccount',
    icon: UserX,
    label: 'Delete your account',
    caption: 'How to delete it, with or without the app',
  },
];

/**
 * The three public pages (Terms, Privacy, account deletion) as a card of
 * rows, for Help and Profile. Each opens the page the API host serves
 * (constants/legal), so the text people read is the published one.
 */
export function PolicyLinksCard() {
  return (
    <Card padding="none" className="py-1 overflow-hidden">
      {ROWS.map((row, idx) => {
        const Icon = row.icon;
        return (
          <View key={row.page}>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                void openPublicPage(row.page);
              }}
              className="flex-row items-center py-3 px-4"
              style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
              android_ripple={{ color: `${LightColors.primary}14` }}
              accessibilityRole="link"
              accessibilityLabel={row.label}
              accessibilityHint={`Opens ${PUBLIC_PAGES[row.page].url}`}
            >
              <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center">
                <Icon size={18} color={LightColors.primary} strokeWidth={1.9} />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-[14px] font-montserrat-semi text-textPrimary">{row.label}</Text>
                <Text className="text-[11px] font-montserrat text-textTertiary">{row.caption}</Text>
              </View>
              <ArrowUpRight size={16} color={LightColors.textTertiary} strokeWidth={2} />
            </Pressable>
            {idx < ROWS.length - 1 && <Hairline />}
          </View>
        );
      })}
    </Card>
  );
}
