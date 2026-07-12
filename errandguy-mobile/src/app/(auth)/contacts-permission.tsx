import React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import {
  PermissionPrimer,
  type PermissionStatus,
} from '../../components/auth/PermissionPrimer';

const CONTACT_PERMISSION = require('../../../assets/contact-permission.png');

// expo-contacts requires a native build and is not available in Expo Go.
let Contacts: typeof import('expo-contacts') | null = null;
try {
  Contacts = require('expo-contacts');
} catch {
  // Native module unavailable (e.g. Expo Go)
}

// WHY contacts access matters — concrete benefits, not an abstract paragraph.
const WHY_CONTACTS = [
  'Add recipients faster',
  'Set up trusted contacts for safety',
  'No typing long phone numbers',
];

// Returning null tells the primer the native module is missing so it
// degrades to a plain Continue button instead of a no-op ask.
const checkStatus = async (): Promise<PermissionStatus | null> => {
  if (!Contacts) return null;
  const { status, canAskAgain } = await Contacts.getPermissionsAsync();
  return { granted: status === 'granted', canAskAgain };
};

const requestPermission = async (): Promise<PermissionStatus | null> => {
  if (!Contacts) return null;
  const { status, canAskAgain } = await Contacts.requestPermissionsAsync();
  return { granted: status === 'granted', canAskAgain };
};

/**
 * Contacts permission screen — step 2 of the two-step permission primer.
 * All lifecycle behavior lives in the shared PermissionPrimer.
 */
export default function ContactsPermissionScreen() {
  const router = useRouter();

  return (
    <PermissionPrimer
      illustrationSource={CONTACT_PERMISSION}
      title="Access your contacts"
      reasons={WHY_CONTACTS}
      stepIndex={2}
      privacyNote="Your contacts stay on your phone — we only use the ones you pick."
      checkStatus={checkStatus}
      requestPermission={requestPermission}
      grantedLabel="Contacts access enabled"
      blockedTitle="Contacts are turned off for ErrandGuy"
      blockedBody={`Open ${Platform.OS === 'ios' ? 'Settings' : 'App info'} → Permissions → Contacts to turn it on.`}
      allowLabel="Allow Contacts"
      requestErrorMessage="Couldn’t open contacts. You can add recipients manually."
      skipHint="Continues without granting contacts access — you can add recipients manually"
      onNext={() => router.push('/(auth)/login')}
    />
  );
}
