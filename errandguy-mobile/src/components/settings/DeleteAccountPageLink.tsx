import React from 'react';
import { Linking, Pressable, Text } from 'react-native';
import { DELETE_ACCOUNT_URL } from '../../constants/legal';
import { toast } from '../../stores/toastStore';

interface DeleteAccountPageLinkProps {
  label?: string;
  className?: string;
}

/**
 * Opens the public "delete your account" web page — how to delete an account,
 * and how to ask for it without the app. Linked from every place the app
 * describes account deletion.
 */
export function DeleteAccountPageLink({
  label = 'Delete your account on the web',
  className = '',
}: DeleteAccountPageLinkProps) {
  return (
    <Pressable
      onPress={() => {
        Linking.openURL(DELETE_ACCOUNT_URL).catch(() =>
          toast.error(`Couldn’t open the page. You can visit ${DELETE_ACCOUNT_URL} in your browser.`),
        );
      }}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={`Opens ${DELETE_ACCOUNT_URL}`}
      className={`self-start ${className}`}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
    >
      <Text className="text-[13px] font-montserrat-semi text-primary underline">{label}</Text>
    </Pressable>
  );
}
