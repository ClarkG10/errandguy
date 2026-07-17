import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

// Central registry for the generated illustration / 3D assets so every
// require() is static (Metro requirement) and lives in one place.
const SOURCES = {
  // onboarding
  'onboarding-book': require('../../../assets/illustrations/onboarding-book.png'),
  'onboarding-track': require('../../../assets/illustrations/onboarding-track.png'),
  'onboarding-safety': require('../../../assets/illustrations/onboarding-safety.png'),
  // empty states
  'empty-bookings': require('../../../assets/illustrations/empty-bookings.png'),
  'empty-notifications': require('../../../assets/illustrations/empty-notifications.png'),
  'empty-search': require('../../../assets/illustrations/empty-search.png'),
  'empty-offline': require('../../../assets/illustrations/empty-offline.png'),
  'empty-wallet': require('../../../assets/illustrations/empty-wallet.png'),
  'empty-addresses': require('../../../assets/illustrations/empty-addresses.png'),
  'empty-contacts': require('../../../assets/illustrations/empty-contacts.png'),
  'empty-promos': require('../../../assets/illustrations/empty-promos.png'),
  'empty-cart': require('../../../assets/illustrations/empty-cart.png'),
  'empty-error': require('../../../assets/illustrations/empty-error.png'),
  // success
  'success-booking': require('../../../assets/illustrations/success-booking.png'),
  'success-payment': require('../../../assets/illustrations/success-payment.png'),
  'success-matched': require('../../../assets/illustrations/success-matched.png'),
  'success-rated': require('../../../assets/illustrations/success-rated.png'),
  // error / lifecycle
  'error-generic': require('../../../assets/illustrations/error-generic.png'),
  'error-no-runner': require('../../../assets/illustrations/error-no-runner.png'),
  'error-payment-failed': require('../../../assets/illustrations/error-payment-failed.png'),
  'error-not-found': require('../../../assets/illustrations/error-not-found.png'),
  'booking-cancelled': require('../../../assets/illustrations/booking-cancelled.png'),
  'refund-requested': require('../../../assets/illustrations/refund-requested.png'),
  'refund-processed': require('../../../assets/illustrations/refund-processed.png'),
  'account-deleted': require('../../../assets/illustrations/account-deleted.png'),
  'session-expired': require('../../../assets/illustrations/session-expired.png'),
  'maintenance': require('../../../assets/illustrations/maintenance.png'),
  'update-required': require('../../../assets/illustrations/update-required.png'),
  'location-off': require('../../../assets/illustrations/location-off.png'),
  // auth
  'auth-login': require('../../../assets/illustrations/auth-login.png'),
  'auth-otp': require('../../../assets/illustrations/auth-otp.png'),
  'auth-forgot': require('../../../assets/illustrations/auth-forgot.png'),
  'role-select': require('../../../assets/illustrations/role-select.png'),
  // runner
  'runner-onboarding': require('../../../assets/illustrations/runner-onboarding.png'),
  'runner-verify': require('../../../assets/illustrations/runner-verify.png'),
  'runner-offline': require('../../../assets/illustrations/runner-offline.png'),
  'runner-no-jobs': require('../../../assets/illustrations/runner-no-jobs.png'),
  'runner-earnings-empty': require('../../../assets/illustrations/runner-earnings-empty.png'),
  'runner-payout-success': require('../../../assets/illustrations/runner-payout-success.png'),
  'runner-rated': require('../../../assets/illustrations/runner-rated.png'),
  // 3D hero objects
  '3d-parcel': require('../../../assets/3d/3d-parcel.png'),
  '3d-wallet': require('../../../assets/3d/3d-wallet.png'),
  '3d-pin': require('../../../assets/3d/3d-pin.png'),
  '3d-coins': require('../../../assets/3d/3d-coins.png'),
  '3d-gift': require('../../../assets/3d/3d-gift.png'),
  '3d-shield': require('../../../assets/3d/3d-shield.png'),
  '3d-receipt': require('../../../assets/3d/3d-receipt.png'),
  '3d-bike': require('../../../assets/3d/3d-bike.png'),
} as const;

export type IllustrationName = keyof typeof SOURCES;

interface IllustrationProps {
  name: IllustrationName;
  /** Square render size in pt. */
  size?: number;
  style?: StyleProp<ImageStyle>;
}

/** Renders a generated illustration / 3D asset at a square size. */
export function Illustration({ name, size = 160, style }: IllustrationProps) {
  return (
    <Image
      source={SOURCES[name]}
      style={[{ width: size, height: size, resizeMode: 'contain' }, style]}
      accessibilityIgnoresInvertColors
    />
  );
}
