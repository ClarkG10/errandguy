import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { OTPInput } from '../ui/OTPInput';
import { Button } from '../ui/Button';
import { SettingsSheet } from './SettingsSheet';
import { useCountdown } from '../../hooks/useCountdown';
import { authService } from '../../services/auth.service';
import { userService } from '../../services/user.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { APP_CONFIG } from '../../constants/config';
import { copy } from '../../constants/copy';
import { errorMessage } from '../../utils/errorCatalog';
import { haptics } from '../../utils/haptics';
import type { User } from '../../types';

const CODE_LENGTH = APP_CONFIG.OTP_LENGTH;
const RESEND_COOLDOWN_S = APP_CONFIG.OTP_COUNTDOWN;

interface VerifyEmailSheetProps {
  visible: boolean;
  email: string;
  onClose: () => void;
}

/**
 * Verify the signed-in account's email: opening the sheet emails a 6-digit
 * code, and the six digits verify themselves (same OTP cells and resend
 * cooldown as sign-up's verify step). On success the profile's
 * `email_verified` flips and the Profile row that opened this disappears.
 */
export function VerifyEmailSheet({ visible, email, onClose }: VerifyEmailSheetProps) {
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  // 'idle' only between closing and the next open, which sends at once — so
  // it reads as "sending", never as a failure.
  const [delivery, setDelivery] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [verifying, setVerifying] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const verifyingRef = useRef(false);
  const requestingRef = useRef(false);
  const { isExpired, start, reset, formatted } = useCountdown(RESEND_COOLDOWN_S);

  /**
   * The email is confirmed: flip the flag (the Profile row disappears), adopt
   * the profile the server returned — or re-read it — and close.
   */
  const markVerified = useCallback(
    (fresh: User | null) => {
      useAuthStore.getState().updateProfile({ email_verified: true });
      if (fresh?.id) {
        useAuthStore.getState().setUser(fresh);
      } else {
        userService
          .getProfile()
          .then((res) => {
            const profile = (res.data?.data ?? null) as User | null;
            if (profile?.id) useAuthStore.getState().setUser(profile);
          })
          .catch(() => {});
      }
      toast.success(copy.auth.emailVerified);
      onClose();
    },
    [onClose],
  );

  const sendCode = useCallback(async () => {
    if (requestingRef.current) return; // double-tap guard — two sends = two codes
    requestingRef.current = true;
    setRequesting(true);
    setDelivery((prev) => (prev === 'sent' ? prev : 'sending'));
    setCodeError(null);
    setNotice(null);
    try {
      const res = await authService.sendEmailVerification(email);
      // Already confirmed (another device, or a reset code proved it): say so
      // instead of waiting for a code that isn't coming.
      if (res?.data?.data?.email_verified === true) {
        markVerified(null);
        return;
      }
      setDelivery('sent');
      setCode('');
      reset(RESEND_COOLDOWN_S);
      start();
    } catch (err) {
      haptics.error();
      setDelivery((prev) => (prev === 'sent' ? prev : 'failed'));
      setNotice(errorMessage(err, copy.auth.otpResendFailed));
    } finally {
      requestingRef.current = false;
      setRequesting(false);
    }
  }, [email, reset, start, markVerified]);
  const sent = delivery === 'sent';
  const sending = delivery === 'sending' || delivery === 'idle';

  // Opening the sheet is the request: send the first code straight away.
  // Closing it forgets the attempt so the next open starts clean.
  useEffect(() => {
    if (visible) {
      void sendCode();
    } else {
      setCode('');
      setCodeError(null);
      setDelivery('idle');
      setVerified(false);
      setNotice(null);
    }
    // sendCode is stable for a given email; re-running on its identity would
    // send a second email mid-attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const verify = useCallback(
    async (value: string) => {
      if (verifyingRef.current || value.length !== CODE_LENGTH) return;
      verifyingRef.current = true;
      setVerifying(true);
      try {
        const res = await authService.verifyEmail(email, value);
        haptics.success();
        setVerified(true);
        markVerified((res?.data?.data ?? null) as User | null);
      } catch (err) {
        const remaining = (err as { attempts_remaining?: number } | null)?.attempts_remaining;
        const base = errorMessage(err, 'That code didn’t work. Check it and try again.');
        setCodeError(
          remaining === undefined
            ? base
            : remaining > 0
              ? `${base} — ${remaining} attempts left`
              : 'Too many attempts. Request a new code below.',
        );
        setCode('');
        // A code that can't be used any more: offer a new one right away
        // rather than after the cooldown.
        const code = (err as { code?: string } | null)?.code;
        if (code === 'OTP_EXPIRED' || code === 'OTP_MAX_ATTEMPTS' || remaining === 0) reset(0);
      } finally {
        verifyingRef.current = false;
        setVerifying(false);
      }
    },
    [email, markVerified, reset],
  );

  const handleCodeChange = useCallback(
    (value: string) => {
      setCodeError(null);
      setCode(value);
      if (value.length === CODE_LENGTH) void verify(value);
    },
    [verify],
  );

  return (
    <SettingsSheet
      visible={visible}
      onClose={onClose}
      busy={verifying}
      title="Verify your email"
      subtitle={
        <>
          {sent
            ? 'We’ve emailed you a 6-digit code at '
            : sending
              ? 'Sending a 6-digit code to '
              : 'We couldn’t send a code to '}
          <Text className="font-montserrat-semi text-textPrimary">{email}</Text>
          {sending && !sent ? '…' : '.'}
        </>
      }
      dismissLabel="Close email verification"
      notice={notice}
    >
      <OTPInput
        length={CODE_LENGTH}
        value={code}
        onChange={handleCodeChange}
        error={codeError ?? undefined}
        success={verified}
      />

      <View className="items-center mt-4 mb-4">
        {sent && !isExpired ? (
          <Text className="text-sm font-montserrat text-textSecondary" style={{ minHeight: 44, lineHeight: 44 }}>
            Resend code in{' '}
            <Text className="font-inter-medium text-textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
              {formatted}
            </Text>
          </Text>
        ) : !sent && sending ? (
          // First send in flight — no resend to offer yet. Same 44pt line, so
          // the row doesn't jump when the countdown takes over.
          <Text className="text-sm font-montserrat text-textSecondary" style={{ minHeight: 44, lineHeight: 44 }}>
            Sending code…
          </Text>
        ) : (
          <Pressable
            onPress={() => void sendCode()}
            disabled={requesting}
            accessibilityRole="button"
            accessibilityLabel={sent ? 'Resend code' : 'Send code'}
            accessibilityState={{ disabled: requesting, busy: requesting }}
            hitSlop={8}
            className="min-h-[44px] justify-center px-4"
            style={{ opacity: requesting ? 0.45 : 1 }}
          >
            <Text className="text-sm font-montserrat text-textSecondary">
              {sent ? 'Didn’t receive it? ' : 'No code yet? '}
              <Text className="text-primary font-montserrat-semi">{sent ? 'Resend' : 'Send again'}</Text>
            </Text>
          </Pressable>
        )}
      </View>

      <Button
        title="Verify"
        fullWidth
        loading={verifying}
        loadingTitle="Verifying…"
        disabled={code.length !== CODE_LENGTH}
        onPress={() => void verify(code)}
      />
      <Button title="Not now" variant="ghost" fullWidth disabled={verifying} onPress={onClose} />
    </SettingsSheet>
  );
}
