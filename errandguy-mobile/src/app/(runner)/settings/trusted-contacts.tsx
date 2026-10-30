import React from 'react';
import { TrustedContactsScreen } from '../../../components/safety/TrustedContactsScreen';

/**
 * Runners need the same people one tap away: the cockpit's no-signal SOS sheet
 * and the SOS-active card both offer the contacts this screen caches.
 */
export default function RunnerTrustedContactsScreen() {
  return <TrustedContactsScreen fallbackHref="/(runner)/(tabs)/profile" />;
}
