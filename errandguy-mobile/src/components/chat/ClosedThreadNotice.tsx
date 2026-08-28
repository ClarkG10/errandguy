import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Replaces the composer once an errand has ended.
 *
 * Closed bookings stay in the inbox for 14 days (ChatController::conversations)
 * so the history is readable, but ChatController::store 422s any send on a
 * completed/cancelled booking. The composer used to stay fully enabled there:
 * the user typed, tapped send, and only THEN got a failed bubble plus a
 * "Cannot send messages on a closed booking" toast. This says so up front.
 *
 * History is untouched — only the input goes away.
 */
export function ClosedThreadNotice({ status }: { status: string | null }) {
  const insets = useSafeAreaInsets();

  const reason =
    status === 'cancelled'
      ? 'This errand was cancelled'
      : status === 'no_runner'
        ? 'This errand ended without a runner'
        : 'This errand is complete';

  return (
    <View
      className="px-6 pt-3 border-t border-divider bg-surfaceMuted"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      accessibilityRole="text"
    >
      <Text className="text-[12px] font-montserrat text-textSecondary text-center">
        {reason} — messages are read-only.
      </Text>
    </View>
  );
}
