import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { AlertCircle, XCircle, RefreshCw, CheckCircle } from 'lucide-react-native';
import type { VerificationStatus } from '../../types';
import { LightColors } from '../../constants/colors';

interface VerificationBannerProps {
  status: VerificationStatus;
  onAction?: () => void;
}

// Status → design-system status token (soft wash + *Dark text rung +
// base glyph tone), replacing the off-palette raw Tailwind defaults
// (yellow-50 / red-800 / orange-*) this banner shipped with. `text` is
// the *Dark rung because the title (13px) and message (12px) are both
// small text and must clear the 4.5:1 AA floor on the soft wash — the
// base tones don't. `color` stays the brighter base tone for the 20px
// glyph, mirroring the notifications-row convention. Pending stays
// warning (waiting); rejected/resubmit are earning-blocking → danger,
// matching the profile hub's own preview-color grouping.
const CONFIG: Record<VerificationStatus, {
  icon: typeof AlertCircle;
  bg: string;
  text: string;
  color: string;
  message: string;
  action?: string;
}> = {
  pending: {
    icon: AlertCircle,
    bg: 'bg-warningSoft',
    text: 'text-warningDark',
    color: LightColors.warning,
    message: 'Your account is under review. Verification typically takes 1–2 business days.',
    // Pending runners previously had no way to review what they had
    // submitted — every other state links to the documents screen, so
    // pending should too.
    action: 'View documents',
  },
  rejected: {
    icon: XCircle,
    bg: 'bg-dangerSoft',
    text: 'text-dangerDark',
    color: LightColors.danger,
    message: 'Your verification was rejected. See which document failed and upload it again.',
    action: 'See what to fix',
  },
  resubmit: {
    icon: RefreshCw,
    bg: 'bg-dangerSoft',
    text: 'text-dangerDark',
    color: LightColors.danger,
    message: 'Some documents need uploading again before you can go online.',
    action: 'Upload again',
  },
  approved: {
    icon: CheckCircle,
    bg: 'bg-successSoft',
    text: 'text-successDark',
    color: LightColors.success,
    message: 'Your account is verified and approved.',
  },
};

const TITLES: Record<Exclude<VerificationStatus, 'approved'>, string> = {
  pending: 'Verification pending',
  rejected: 'Verification rejected',
  resubmit: 'Documents needed again',
};

export function VerificationBanner({ status, onAction }: VerificationBannerProps) {
  if (status === 'approved') return null;

  const config = CONFIG[status];
  const Icon = config.icon;

  return (
    <View className={`mx-5 mb-4 p-4 rounded-2xl ${config.bg}`}>
      <View className="flex-row items-start gap-3">
        <Icon size={20} color={config.color} />
        <View className="flex-1">
          <Text className={`text-sm font-montserrat-bold ${config.text}`} accessibilityRole="header">
            {TITLES[status]}
          </Text>
          <Text className={`text-[13px] leading-[18px] font-montserrat ${config.text} mt-1`}>
            {config.message}
          </Text>
          {config.action && onAction && (
            <Pressable
              onPress={onAction}
              accessibilityRole="button"
              accessibilityLabel={config.action}
              // Static style: a function `style` on a Pressable drops its
              // layout under NativeWind. 44pt tall on its own.
              className="mt-1 self-start justify-center active:opacity-60"
              style={{ minHeight: 44 }}
              hitSlop={{ left: 8, right: 16 }}
            >
              <Text className="text-[13px] font-montserrat-bold text-primary">
                {config.action}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
