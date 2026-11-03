import React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import {
  PermissionPrimer,
  type PermissionStatus,
} from '../../components/auth/PermissionPrimer';

const LOCATION_PERMISSION = require('../../../assets/location-permission.png');

// WHY location matters — concrete benefits, not an abstract paragraph. True
// for customers and runners alike: nobody has picked a side yet.
const WHY_LOCATION = [
  'Fill in addresses with one tap',
  'Match errands with runners nearby',
  'Live tracking and arrival times',
];

const checkStatus = async (): Promise<PermissionStatus | null> => {
  const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  return { granted: status === 'granted', canAskAgain };
};

const requestPermission = async (): Promise<PermissionStatus | null> => {
  const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  return { granted: status === 'granted', canAskAgain };
};

/**
 * Location permission screen — the last onboarding step before sign-up
 * ("Get Started" is for new people; returning ones use "Log in" on the
 * welcome screen and on sign-up). All lifecycle behavior lives in the shared
 * PermissionPrimer.
 */
export default function LocationPermissionScreen() {
  const router = useRouter();

  return (
    <PermissionPrimer
      illustrationSource={LOCATION_PERMISSION}
      title="Allow location access"
      reasons={WHY_LOCATION}
      checkStatus={checkStatus}
      requestPermission={requestPermission}
      grantedLabel="Location access enabled"
      blockedTitle="Location is turned off for ErrandGuy"
      blockedBody={`Open ${Platform.OS === 'ios' ? 'Settings' : 'App info'} → Permissions → Location to turn it on.`}
      allowLabel="Allow Location"
      requestErrorMessage="Couldn’t check location access. You can enable it later in Settings."
      skipHint="Continues without granting location access — you can enable it later in Settings"
      // Log in goes underneath sign-up, so back (the arrow, or Android's back
      // button) lands on Log in instead of closing the app.
      onNext={() => {
        router.replace('/(auth)/login');
        router.push('/(auth)/register');
      }}
    />
  );
}
