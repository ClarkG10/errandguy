import React, { useCallback, useRef, useState } from 'react';
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
import { useForm, Controller } from 'react-hook-form';
import { ChevronLeft } from 'lucide-react-native';
import { OTPInput } from '../../components/ui/OTPInput';
import { Input, type InputHandle } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { PasswordStrengthIndicator } from '../../components/auth/PasswordStrengthIndicator';
import { useCountdown } from '../../hooks/useCountdown';
import { authService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { errorMessage, tooManyAttemptsMessage } from '../../utils/errorCatalog';
import { confirmPasswordRules, newPasswordRules } from '../../utils/validation/passwordPolicy';
import { APP_CONFIG } from '../../constants/config';
import { copy } from '../../constants/copy';
import { LightColors } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';

interface ResetPasswordFormData {
  password: string;
  confirm_password: string;
}

const CODE_LENGTH = APP_CONFIG.OTP_LENGTH;
const RESEND_COOLDOWN_S = APP_CONFIG.OTP_COUNTDOWN;

/**
 * Step 2 of 2 of "Forgot password": the 6-digit code from the email plus the
 * new password, in one submit (POST /auth/reset-password). The server signs
 * the account out on every device, so this ends at the login screen.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const { contentMaxWidth } = useResponsive();
  const clearBiometricSession = useAuthStore((s) => s.clearBiometricSession);

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const passwordRef = useRef<InputHandle>(null);
  const confirmRef = useRef<InputHandle>(null);

  // The first code was just sent by the previous screen — same cooldown
  // pattern as verify-otp before a resend is offered.
  const { isExpired, start, reset, formatted } = useCountdown(RESEND_COOLDOWN_S, true);

  const {
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { password: '', confirm_password: '' },
  });
  const password = watch('password');

  const goBack = useCallback(
    () => (router.canGoBack() ? router.back() : router.replace('/(auth)/forgot-password')),
    [router],
  );

  const handleCodeChange = useCallback((value: string) => {
    setCodeError(null);
    setCode(value);
    // Six digits in: move straight on to the new password.
    if (value.length === CODE_LENGTH) passwordRef.current?.focus();
  }, []);

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (code.length !== CODE_LENGTH) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setCodeError(`Enter the ${CODE_LENGTH}-digit code from the email.`);
      return;
    }
    setLoading(true);
    try {
      await authService.resetPassword({
        email,
        code,
        password: data.password,
        password_confirmation: data.confirm_password,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Every session on the account was just revoked server-side, so a token
      // this phone was holding behind a biometric lock is dead too — drop it
      // rather than offer an "Unlock" that can only fail.
      await clearBiometricSession().catch(() => {});
      toast.success(copy.auth.passwordReset);
      router.replace('/(auth)/login');
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const status = error?.status;
      const fieldErrors = (error?.errors ?? {}) as Record<string, string[] | string>;
      const first = (key: string) => {
        const v = fieldErrors[key];
        return Array.isArray(v) ? v[0] : v;
      };
      if (status === 422) {
        const emailMessage = first('email');
        if (emailMessage) {
          // The address itself was refused; it is edited on the previous step.
          toast.error(emailMessage);
          return;
        }
        const passwordMessage = first('password');
        const codeMessage = first('code') ?? first('token');
        if (passwordMessage) setError('password', { message: passwordMessage });
        if (codeMessage || !passwordMessage) {
          // A wrong / expired code — or a 422 that names no field, which on
          // this endpoint is the code (OTP_INVALID / OTP_EXPIRED /
          // OTP_MAX_ATTEMPTS) — belongs on the code cells.
          const remaining: number | undefined = error?.attempts_remaining;
          const base = codeMessage ?? errorMessage(error, 'That code didn’t work. Check it or request a new one.');
          setCodeError(remaining !== undefined && remaining > 0 ? `${base} — ${remaining} attempts left` : base);
          setCode('');
          // A code that can't be used any more: offer a new one right away
          // rather than after the cooldown.
          if (error?.code === 'OTP_EXPIRED' || error?.code === 'OTP_MAX_ATTEMPTS' || remaining === 0) {
            reset(0);
          }
        }
        return;
      }
      if (!status) {
        toast.error('Unable to reach the server. Check your internet connection.');
      } else if (status === 429) {
        toast.error(tooManyAttemptsMessage(error));
      } else {
        toast.error(errorMessage(error, copy.generic.tryAgain));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending) return; // double-tap guard — two sends = two codes in the inbox
    Haptics.selectionAsync().catch(() => {});
    setResending(true);
    try {
      await authService.forgotPassword(email);
      reset(RESEND_COOLDOWN_S);
      start();
      setCode('');
      setCodeError(null);
      toast.success(copy.auth.resetSent);
    } catch (error: any) {
      toast.error(errorMessage(error, copy.auth.otpResendFailed));
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            width: '100%',
            maxWidth: contentMaxWidth,
            alignSelf: 'center',
            paddingBottom: 32,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
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
              className="text-[11px] font-montserrat-bold uppercase text-primary mb-3"
              style={{ letterSpacing: 1.8 }}
            >
              Reset password
            </Text>
            <Text
              className="text-[28px] font-montserrat-bold text-ink"
              style={{ letterSpacing: -0.4, lineHeight: 32 }}
              accessibilityRole="header"
            >
              Enter your code
            </Text>
            <Text className="text-[15px] font-montserrat text-textSecondary mt-2 mb-8">
              We've emailed you a 6-digit code at{' '}
              <Text className="font-montserrat-semi text-textPrimary">{email}</Text>. It can take
              a minute — check your spam folder too.{' '}
              <Text
                className="text-primary font-montserrat-semi"
                onPress={goBack}
                accessibilityRole="link"
                accessibilityLabel="Change email address"
              >
                Change
              </Text>
            </Text>

            <OTPInput
              length={CODE_LENGTH}
              value={code}
              onChange={handleCodeChange}
              error={codeError ?? undefined}
            />

            <View className="items-center mt-4 mb-6">
              {!isExpired ? (
                <Text
                  className="text-sm font-montserrat text-textSecondary"
                  // Same 44pt line as the resend button so the row doesn't
                  // jump when the countdown ends.
                  style={{ minHeight: 44, lineHeight: 44 }}
                >
                  Resend code in{' '}
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
                  accessibilityLabel="Resend code"
                  accessibilityState={{ disabled: resending, busy: resending }}
                  hitSlop={8}
                  className="min-h-[44px] justify-center px-4"
                  style={{ opacity: resending ? 0.45 : 1 }}
                >
                  <Text className="text-sm font-montserrat text-textSecondary">
                    Didn't receive it?{' '}
                    <Text className="text-primary font-montserrat-semi">Resend</Text>
                  </Text>
                </Pressable>
              )}
            </View>

            <Controller
              control={control}
              name="password"
              rules={newPasswordRules}
              render={({ field: { onChange, onBlur, value } }) => (
                <>
                  <Input
                    ref={passwordRef}
                    label="New Password"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="Create a strong password"
                    secureTextEntry
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => confirmRef.current?.focus()}
                    error={errors.password?.message}
                  />
                  <PasswordStrengthIndicator password={value} />
                </>
              )}
            />

            <Controller
              control={control}
              name="confirm_password"
              rules={confirmPasswordRules(() => password)}
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={confirmRef}
                  label="Confirm New Password"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="Type it again"
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={handleSubmit(onSubmit)}
                  error={errors.confirm_password?.message}
                />
              )}
            />

            <Button
              title="Reset Password"
              fullWidth
              size="lg"
              loading={loading}
              loadingTitle="Resetting…"
              onPress={handleSubmit(onSubmit)}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
