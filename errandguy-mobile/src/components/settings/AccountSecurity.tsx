import React, { useCallback, useState } from 'react';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ChangePasswordSheet } from './ChangePasswordSheet';
import { VerifyEmailSheet } from './VerifyEmailSheet';
import { signOutEverywhere } from '../../services/session.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { copy } from '../../constants/copy';
import { errorMessage } from '../../utils/errorCatalog';
import { haptics } from '../../utils/haptics';

type Sheet = 'password' | 'email' | 'signOutEverywhere';

/**
 * Account security for both Profile screens (customer and runner): Verify
 * email, Change password and Sign out of all devices. The screen decides
 * where the rows go; this owns what they open, so the two roles can't drift.
 *
 *   const security = useAccountSecurity();
 *   …rows calling security.openChangePassword() etc…
 *   {security.sheets}
 */
export function useAccountSecurity() {
  const email = useAuthStore((s) => s.user?.email ?? null);
  const emailVerified = useAuthStore((s) => s.user?.email_verified);
  // The cold-start snapshot carries no email and a placeholder
  // email_verified:false — never offer verification off it (userIsProvisional).
  const provisional = useAuthStore((s) => s.userIsProvisional);
  const [open, setOpen] = useState<Sheet | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const close = useCallback(() => setOpen(null), []);

  const confirmSignOutEverywhere = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOutEverywhere();
      setOpen(null);
      // The root route gate takes this phone to the login screen.
      toast.success(copy.auth.signedOutEverywhere);
    } catch (err) {
      haptics.error();
      // Close first: a toast renders beneath the native confirm modal.
      setOpen(null);
      toast.error(errorMessage(err, 'Couldn’t sign out your other devices. Please try again.'));
    } finally {
      setSigningOut(false);
    }
  }, []);

  const sheets = (
    <>
      <ChangePasswordSheet visible={open === 'password'} onClose={close} />
      {email ? <VerifyEmailSheet visible={open === 'email'} email={email} onClose={close} /> : null}
      <ConfirmModal
        visible={open === 'signOutEverywhere'}
        title="Sign out of all devices?"
        message="Every phone signed in to your account — including this one — will be signed out. You’ll need your password to sign back in."
        confirmLabel="Sign out everywhere"
        confirmLoadingLabel="Signing out…"
        destructive
        loading={signingOut}
        onConfirm={confirmSignOutEverywhere}
        onCancel={() => {
          if (!signingOut) close();
        }}
      />
    </>
  );

  return {
    /** Show "Verify email" only for a loaded profile whose email is unverified. */
    needsEmailVerification: !provisional && !!email && emailVerified === false,
    openVerifyEmail: () => setOpen('email'),
    openChangePassword: () => setOpen('password'),
    openSignOutEverywhere: () => setOpen('signOutEverywhere'),
    sheets,
  };
}
