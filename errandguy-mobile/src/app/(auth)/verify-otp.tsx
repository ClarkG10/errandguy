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
import { useCountdown } from '../../hooks/useCountdown';
import { authService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';

export default function VerifyOTPScreen() {
  const router = useRouter();
  const { phone, email, purpose } = useLocalSearchParams<{
    phone?: string;
    email?: string;
    purpose?: string;
  }>();
  const { contentMaxWidth } = useResponsive();

  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);

  const { isExpired, start, reset, formatted } = useCountdown(300, true);

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
      const base = error?.message || 'Verification failed. Please try again.';
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
      reset(300);
      start();
      setAttemptsRemaining(5);
      setOtpError(null);
      toast.success('Code resent successfully.');
    } catch (error: any) {
      const message = error?.message || 'Failed to resend code. Please try again later.';
      toast.error(message);
    } finally {
      setResending(false);
    }
  };

  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace('/(auth)/login');

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
            className="mt-2 ml-6 mb-8 w-10 h-10 rounded-full items-center justify-center bg-surface border border-divider"
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={22} color={LightColors.ink} strokeWidth={2.2} />
          </Pressable>

          <View className="px-6">
            <Text
              className="text-[11px] font-montserrat-bold uppercase text-primary mb-3"
              style={{ letterSpacing: 1.8 }}
            >
              Verification
            </Text>
            <Text
              className="text-[28px] font-montserrat-bold text-ink"
              style={{ letterSpacing: -0.4, lineHeight: 32 }}
              accessibilityRole="header"
            >
              Verify your {phone ? 'number' : 'email'}
            </Text>
            <Text className="text-[15px] font-montserrat text-textSecondary mt-2 mb-8">
              We sent a 6-digit code to{' '}
              <Text className="font-montserrat-semi text-textPrimary">
                {maskedIdentifier}
              </Text>
              .{' '}
              <Text
                className="text-primary font-montserrat-semi"
                onPress={goBack}
                accessibilityRole="link"
                accessibilityLabel={phone ? 'Change phone number' : 'Change email address'}
              >
                Change
              </Text>
            </Text>

            <OTPInput
              value={code}
              onChange={handleCodeChange}
              error={otpError ?? undefined}
              success={otpSuccess}
            />

            <View className="items-center mt-6 mb-6">
              {!isExpired && attemptsRemaining > 0 ? (
                <Text
                  className="text-sm font-montserrat text-textSecondary"
                  // Match the resend pressable's 44pt height so the row
                  // doesn't shift when the countdown expires.
                  style={{ minHeight: 44, lineHeight: 44 }}
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
                  hitSlop={8}
                  className="min-h-[44px] justify-center px-4"
                  style={{ opacity: resending ? 0.45 : 1 }}
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
            </View>

            <Button
              title="Verify"
              fullWidth
              size="lg"
              loading={loading}
              loadingTitle="Verifying…"
              disabled={code.length !== 6 || attemptsRemaining === 0}
              onPress={handleVerify}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
