import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { OTPInput } from '../../components/ui/OTPInput';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { emailProblem } from '../../components/auth/fieldRules';
import { useCountdown } from '../../hooks/useCountdown';
import { authService } from '../../services/auth.service';
import { userService } from '../../services/user.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { errorMessage } from '../../utils/errorCatalog';
import { email as emailSchema } from '../../utils/validation/schemas';
import { APP_CONFIG } from '../../constants/config';
import { copy } from '../../constants/copy';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';

/**
 * Seconds before "Resend" is offered. Each new code replaces the one still on
 * its way (an email can take a minute), and the server allows only 3 new
 * codes an hour per address (the `otp` throttle) — so the wait is long enough
 * for the first email to arrive, but well short of the old five minutes.
 */
const RESEND_COOLDOWN_S = 2 * APP_CONFIG.OTP_COUNTDOWN;

export default function VerifyOTPScreen() {
  const router = useRouter();
  const { phone, email: emailParam, purpose } = useLocalSearchParams<{
    phone?: string;
    email?: string;
    purpose?: string;
  }>();
  const { contentMaxWidth } = useResponsive();

  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  // The address the code goes to. Starts as the one signed up with; "Change"
  // can correct it right here.
  const [email, setEmail] = useState(emailParam);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState(emailParam ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  const { isExpired, start, reset, formatted } = useCountdown(RESEND_COOLDOWN_S, true);

  // Straight after sign-up the account already exists and is signed in, so a
  // mistyped email is fixed on the account itself (PUT /user/profile, which
  // also marks it unconfirmed) and the code re-sent to the new address.
  // Going "back" used to drop the person at Log in, then on Home with the
  // wrong address still on the account.
  const canChangeEmailHere = purpose === 'register-verify' && !phone && isAuthenticated;

  const maskedIdentifier = phone
    ? phone.replace(/(\d{4})\d{4}(\d{3})/, '$1****$2')
    : email
      ? email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
      : '';

  const handleVerify = useCallback(async () => {
    if (code.length !== 6) return;
    // Bail if attempts are already exhausted — the auto-submit effect
    // would otherwise keep firing on every re-paste from SMS autofill.
    if (attemptsRemaining <= 0) return;
    setLoading(true);
    try {
      const payload = phone ? { phone, code } : { email, code };
      const response = await authService.verifyOTP(payload);
      const data = response.data;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Green beat on the cells before the route swap so the auto-submit
      // reads as a confirmation, not an abrupt cut. Color-only (no motion),
      // so it stays under OS Reduce Motion. setUser/setToken must wait too —
      // on the login flow they trigger the root redirect immediately.
      setOtpSuccess(true);
      await new Promise((resolve) => setTimeout(resolve, 350));

      if (data.user && data.token) {
        await setToken(data.token);
        setUser(data.user);
      }

      if (purpose === 'register-verify') {
        router.replace('/(auth)/role-select');
      } else {
        // Login flow — user + token already set, root layout will redirect
      }
    } catch (error: any) {
      const remaining = error?.attempts_remaining;
      if (remaining !== undefined) {
        setAttemptsRemaining(remaining);
      }
      const base = errorMessage(error, 'That code didn’t work. Check it and try again.');
      // Single feedback locus: attempts info is folded into the inline
      // error on the OTP cells (red + shake via OTPInput) instead of a
      // toast or a second text block — the feedback lands exactly where
      // the user is looking. OTPInput fires the error haptic itself.
      const message =
        remaining === undefined
          ? base
          : remaining > 0
            ? `${base} — ${remaining} attempts left`
            : 'Too many attempts. Request a new code below.';
      setOtpError(message);
      setCode('');
    } finally {
      setLoading(false);
    }
  }, [code, phone, email, purpose, setToken, setUser, router, attemptsRemaining]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6) {
      handleVerify();
    }
  }, [code, handleVerify]);

  // Typing again clears the inline error so the cells reset to neutral.
  const handleCodeChange = useCallback((value: string) => {
    setOtpError(null);
    setCode(value);
  }, []);

  const handleResend = async () => {
    if (resending) return; // double-tap guard — two sends = two valid codes
    Haptics.selectionAsync().catch(() => {});
    setResending(true);
    try {
      const payload = phone ? { phone } : { email };
      await authService.sendOTP(payload);
      reset(RESEND_COOLDOWN_S);
      start();
      setAttemptsRemaining(5);
      setOtpError(null);
      toast.success(copy.auth.otpResent);
    } catch (error: any) {
      const message = errorMessage(error, copy.auth.otpResendFailed);
      toast.error(message);
    } finally {
      setResending(false);
    }
  };

  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace('/(auth)/login');

  const handleChange = () => {
    if (!canChangeEmailHere) {
      goBack();
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setEmailDraft(email ?? '');
    setEmailError(null);
    setEditingEmail(true);
  };

  const handleSaveEmail = async () => {
    if (savingEmail) return;
    const parsed = emailSchema.safeParse(emailDraft);
    if (!parsed.success) {
      // Say how to fix it (pattern 9), not just that it's wrong.
      setEmailError(emailProblem(emailDraft) ?? parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }
    const next = parsed.data;
    if (next.toLowerCase() === (email ?? '').toLowerCase()) {
      setEditingEmail(false);
      return;
    }
    setSavingEmail(true);
    try {
      const res = await userService.updateProfile({ email: next });
      const updated = res.data?.data;
      if (updated) setUser(updated);
    } catch (error: any) {
      const fieldError = error?.errors?.email;
      setEmailError(
        (Array.isArray(fieldError) ? fieldError[0] : fieldError) ??
          errorMessage(error, 'Couldn’t change your email. Please try again.'),
      );
      setSavingEmail(false);
      return;
    }
    // The account now holds the new address, whatever happens to the send.
    setEmail(next);
    setEditingEmail(false);
    setCode('');
    setOtpError(null);
    try {
      await authService.sendOTP({ email: next });
      reset(RESEND_COOLDOWN_S);
      start();
      setAttemptsRemaining(5);
      toast.success('Email updated. We sent a new code.');
    } catch (error: any) {
      // Resend is offered at once so the person isn't left waiting on a code
      // that never went out.
      reset(0);
      toast.error(errorMessage(error, copy.auth.otpResendFailed));
    } finally {
      setSavingEmail(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            width: '100%',
            maxWidth: contentMaxWidth,
            alignSelf: 'center',
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            className="mt-2 ml-6 mb-6 w-10 h-10 rounded-full items-center justify-center bg-surface border border-divider"
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={22} color={LightColors.ink} strokeWidth={2.2} />
          </Pressable>

          <View className="px-6">
            <Text
              className="text-[28px] font-montserrat-bold text-ink"
              style={{ letterSpacing: -0.4, lineHeight: 32 }}
              accessibilityRole="header"
            >
              Verify your {phone ? 'number' : 'email'}
            </Text>
            {editingEmail ? (
              <View className="mt-4 mb-8">
                <Input
                  label="Email address"
                  value={emailDraft}
                  onChangeText={(t) => {
                    setEmailDraft(t);
                    setEmailError(null);
                  }}
                  error={emailError ?? undefined}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  onSubmitEditing={handleSaveEmail}
                  autoFocus
                />
                <View className="mt-3 gap-2">
                  <Button
                    title="Send code to this email"
                    fullWidth
                    loading={savingEmail}
                    loadingTitle="Sending…"
                    onPress={handleSaveEmail}
                  />
                  <Button
                    title="Cancel"
                    variant="ghost"
                    fullWidth
                    disabled={savingEmail}
                    onPress={() => setEditingEmail(false)}
                  />
                </View>
              </View>
            ) : (
              <Text className="text-[15px] font-montserrat text-textSecondary mt-2 mb-8">
                We sent a 6-digit code to{' '}
                <Text className="font-montserrat-semi text-textPrimary">
                  {maskedIdentifier}
                </Text>
                .{phone ? '' : ' It can take a minute — check your spam folder too.'}{' '}
                <Text
                  className="text-primary font-montserrat-semi"
                  onPress={handleChange}
                  accessibilityRole="link"
                  accessibilityLabel={phone ? 'Change phone number' : 'Change email address'}
                >
                  Change
                </Text>
              </Text>
            )}

            <OTPInput
              value={code}
              onChange={handleCodeChange}
              error={otpError ?? undefined}
              success={otpSuccess}
            />

            {/* Right under the code — the OTP error line above already
                reserves its own space, so no extra margin or 44pt line-height
                (that left a big hole between the cells and "Resend"). */}
            <View className="items-center mb-6">
              {!isExpired && attemptsRemaining > 0 ? (
                <Text
                  className="text-sm font-montserrat text-textSecondary"
                  // Same 32pt row as the resend pressable so nothing shifts
                  // when the countdown expires.
                  style={{ minHeight: 32, lineHeight: 32 }}
                >
                  Resend code in{' '}
                  {/* Inter tabular figures — every tick is the same width,
                      so the centered line doesn't jitter each second. */}
                  <Text
                    className="font-inter-medium text-textSecondary"
                    style={{ fontVariant: ['tabular-nums'] }}
                  >
                    {formatted}
                  </Text>
                </Text>
              ) : (
                <Pressable
                  onPress={handleResend}
                  disabled={resending}
                  accessibilityRole="button"
                  accessibilityLabel="Resend verification code"
                  accessibilityState={{ disabled: resending, busy: resending }}
                  // 32pt row + 6pt slop each way = a 44pt target.
                  hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                  className="justify-center px-4"
                  style={{ minHeight: 32, opacity: resending ? 0.45 : 1 }}
                >
                  {attemptsRemaining === 0 ? (
                    // Attempts exhausted — resend IS the recovery path, so
                    // it renders as the primary action even mid-countdown
                    // (handleResend resets attempts; the server still rate
                    // limits abuse).
                    <Text className="text-sm font-montserrat-semi text-primary">
                      Request a new code
                    </Text>
                  ) : (
                    <Text className="text-sm font-montserrat text-textSecondary">
                      Didn't receive it?{' '}
                      <Text className="text-primary font-montserrat-semi">Resend</Text>
                    </Text>
                  )}
                </Pressable>
              )}
              <Text className="text-xs font-montserrat text-textSecondary text-center mt-1">
                A new code replaces the last one. You can ask for 3 an hour.
              </Text>
            </View>

            <Button
              title="Verify"
              fullWidth
              size="lg"
              loading={loading}
              loadingTitle="Verifying…"
              disabled={code.length !== 6 || attemptsRemaining === 0}
              disabledReason={
                attemptsRemaining === 0
                  ? 'Request a new code to try again'
                  : `Enter the 6-digit code we sent to your ${phone ? 'phone' : 'email'}`
              }
              onPress={handleVerify}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
