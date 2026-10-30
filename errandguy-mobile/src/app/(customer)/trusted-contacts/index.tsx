import React from 'react';
import { TrustedContactsScreen } from '../../../components/safety/TrustedContactsScreen';

export default function CustomerTrustedContactsScreen() {
  return <TrustedContactsScreen fallbackHref="/(customer)/(tabs)/profile" />;
}
