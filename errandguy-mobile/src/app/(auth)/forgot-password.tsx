import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, Easing } from 'react-native-reanimated';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ChevronLeft } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Illustration } from '../../components/ui/Illustration';
import { SuccessCheck } from '../../components/ui/SuccessCheck';
import { useCountdown } from '../../hooks/useCountdown';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';
import { authService } from '../../services/auth.service';
import { toast } from '../../stores/toastStore';
import { errorMessage } from '../../utils/errorCatalog';
import { copy } from '../../constants/copy';
import { LightColors } from '../../constants/colors';

interface ForgotPasswordFormData {
  email: string;
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  // Login pre-fills this when the user tapped "Forgot password?" with an
  // email already typed — the most common way to reach this screen.
  const params = useLocalSearchParams<{ email?: string }>();
  const { contentMaxWidth } = useResponsive();
  const reducedMotion = useReducedMotion();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [resending, setResending] = useState(false);

  const { isExpired, start, reset, formatted } = useCountdown(30);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    mode: 'onTouched',
    defaultValues: { email: params.email ?? '' },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setLoading(true);
    try {
      await authService.forgotPassword(data.email);
      // Success haptic comes from the SuccessCheck mounting in the sent
      // state — firing here too would double-buzz.
      setSentTo(data.email);
      setSent(true);
      reset(30);
      start();
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const status = error?.status;
      if (status === 422 && error?.errors?.email?.[0]) {
        // Field-level validation error — render it under the input like
        // login/register do, not as a toast at the screen edge.
        setError('email', { message: error.errors.email[0] });
        return;
      }
      let message: string;
      if (!status) {
        message = 'Unable to reach the server. Check your internet connection.';
      } else if (status === 429) {
        message = 'Too many attempts. Please wait a few minutes and try again.';
      } else if (status >= 500) {
        message = 'Something went wrong on our end. Please try again later.';
      } else {
        message = errorMessage(error, copy.generic.tryAgain);
      }
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending) return;
    Haptics.selectionAsync().catch(() => {});
    setResending(true);
    try {
      await authService.forgotPassword(sentTo);
      reset(30);
      start();
      toast.success('Reset link sent again.');
    } catch (error: any) {
      toast.error(errorMessage(error, copy.auth.otpResendFailed));
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <Pressable
        className="mt-2 ml-6 w-10 h-10 rounded-full items-center justify-center bg-surface border border-divider"
        onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <ChevronLeft size={22} color={LightColors.ink} strokeWidth={2.2} />
      </Pressable>

      {sent ? (
        <Animated.View
          entering={
            reducedMotion
              ? undefined
              : FadeInDown.duration(250).easing(Easing.out(Easing.quad))
          }
          className="flex-1 justify-center items-center px-8"
          style={{ width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' }}
        >
          <View style={{ marginBottom: 20 }}>
            <SuccessCheck size={88} />
          </View>
          <Text
            accessibilityRole="header"
            className="text-2xl font-montserrat-semi text-textPrimary mb-2 text-center"
          >
            Check your email
          </Text>
          <Text className="text-[15px] font-montserrat text-textSecondary text-center mb-10">
            We've sent a reset link to{' '}
            <Text className="font-montserrat-semi text-textPrimary">{sentTo}</Text>. Check
            your inbox.
          </Text>
          <Button
            title="Back to Login"
            fullWidth
            size="lg"
            onPress={() => router.replace('/(auth)/login')}
          />

          <View className="items-center mt-6" style={{ minHeight: 44, justifyContent: 'center' }}>
            {!isExpired ? (
              <Text className="text-sm font-montserrat text-textSecondary">
                Resend link in{' '}
                <Text className="font-inter tabular-nums">{formatted}</Text>
              </Text>
            ) : (
              <Pressable
                onPress={handleResend}
                disabled={resending}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Resend reset link"
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text className="text-sm font-montserrat text-textSecondary">
                  Didn't receive it?{' '}
                  <Text className="text-primary font-montserrat-semi">Resend</Text>
                </Text>
              </Pressable>
            )}
          </View>

          <Pressable
            onPress={() => setSent(false)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Wrong email? Try again"
            style={({ pressed }) => [
              { minHeight: 44, justifyContent: 'center' },
              pressed && { opacity: 0.55 },
            ]}
          >
            <Text className="text-[13px] font-montserrat-semi text-primary">
              Wrong email? Try again
            </Text>
          </Pressable>
        </Animated.View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              paddingHorizontal: 24,
              paddingTop: 16,
              width: '100%',
              maxWidth: contentMaxWidth,
              alignSelf: 'center',
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Illustration
              name="auth-forgot"
              size={148}
              style={{ alignSelf: 'center', marginBottom: 8 }}
            />
            <Text
              accessibilityRole="header"
              className="text-[28px] font-montserrat-bold text-ink"
              style={{ letterSpacing: -0.4, lineHeight: 32 }}
            >
              Reset password
            </Text>
            <Text className="text-[15px] font-montserrat text-textSecondary mt-2 mb-8">
              Enter your email and we'll send you a reset link.
            </Text>

            <Controller
              control={control}
              name="email"
              rules={{
                required: 'Email is required',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Enter a valid email',
                },
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Email"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  autoFocus
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit(onSubmit)}
                  error={errors.email?.message}
                />
              )}
            />

            <Button
              title="Send Reset Link"

              fullWidth
              size="lg"
              loading={loading}
              loadingTitle="Sending link…"
              onPress={handleSubmit(onSubmit)}
            />

            <View className="flex-row items-center justify-center mt-6 py-2">
              <Text className="text-[14px] font-montserrat text-textTertiary">
                Remember your password?{' '}
              </Text>
              <Pressable
                onPress={() => router.replace('/(auth)/login')}
                style={({ pressed }) => pressed && { opacity: 0.55 }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Log in"
              >
                <Text className="text-[14px] font-montserrat-semi text-primary">Log in</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
