import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { AlertCircle, XCircle, RefreshCw, CheckCircle } from 'lucide-react-native';
import type { VerificationStatus } from '../../types';

interface VerificationBannerProps {
  status: VerificationStatus;
  onAction?: () => void;
}

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
    bg: 'bg-yellow-50',
    text: 'text-yellow-800',
    color: '#F59E0B',
    message: 'Your account is under review. Verification typically takes 1-2 business days.',
  },
  rejected: {
    icon: XCircle,
    bg: 'bg-red-50',
    text: 'text-red-800',
    color: '#EF4444',
    message: 'Your verification was rejected. Please review and re-submit your documents.',
    action: 'View Details',
  },
  resubmit: {
    icon: RefreshCw,
    bg: 'bg-orange-50',
    text: 'text-orange-800',
    color: '#F97316',
    message: 'Some documents need to be re-submitted. Please upload updated documents.',
    action: 'Re-submit',
  },
  approved: {
    icon: CheckCircle,
    bg: 'bg-green-50',
    text: 'text-green-800',
    color: '#22C55E',
    message: 'Your account is verified and approved.',
  },
};

export function VerificationBanner({ status, onAction }: VerificationBannerProps) {
  if (status === 'approved') return null;

  const config = CONFIG[status];
  const Icon = config.icon;

  return (
    <View className={`mx-5 mb-4 p-4 rounded-xl ${config.bg}`}>
      <View className="flex-row items-start gap-3">
        <Icon size={20} color={config.color} />
        <View className="flex-1">
          <Text className={`text-sm font-montserrat-bold ${config.text}`}>
            {status === 'pending' ? 'Verification Pending' : status === 'rejected' ? 'Verification Rejected' : 'Re-submit Required'}
          </Text>
          <Text className={`text-xs font-montserrat ${config.text} mt-1`}>
            {config.message}
          </Text>
          {config.action && onAction && (
            <Pressable onPress={onAction} className="mt-2">
              <Text className="text-xs font-montserrat-bold text-primary underline">
                {config.action}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
