import React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import {
  PermissionPrimer,
  type PermissionStatus,
} from '../../components/auth/PermissionPrimer';

const LOCATION_PERMISSION = require('../../../assets/location-permission.png');

// WHY location matters — concrete benefits, not an abstract paragraph.
const WHY_LOCATION = [
  'Find nearby runners',
  'Calculate accurate ETAs',
  'Precise pickup & drop-off',
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
 * Location permission screen — step 1 of the two-step permission primer.
 * All lifecycle behavior lives in the shared PermissionPrimer.
 */
export default function LocationPermissionScreen() {
  const router = useRouter();

  return (
    <PermissionPrimer
      illustrationSource={LOCATION_PERMISSION}
      title="Allow location access"
      reasons={WHY_LOCATION}
      stepIndex={1}
      checkStatus={checkStatus}
      requestPermission={requestPermission}
      grantedLabel="Location access enabled"
      blockedTitle="Location is turned off for ErrandGuy"
      blockedBody={`Open ${Platform.OS === 'ios' ? 'Settings' : 'App info'} → Permissions → Location to turn it on.`}
      allowLabel="Allow Location"
      requestErrorMessage="Couldn’t check location access. You can enable it later in Settings."
      skipHint="Continues without granting location access — you can enable it later in Settings"
      onNext={() => router.push('/(auth)/contacts-permission')}
    />
  );
}
