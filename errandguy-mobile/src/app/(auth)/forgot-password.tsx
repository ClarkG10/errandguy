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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ChevronLeft } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { emailProblem, asRule } from '../../components/auth/fieldRules';
import { useResponsive } from '../../constants/responsive';
import { authService } from '../../services/auth.service';
import { toast } from '../../stores/toastStore';
import { errorMessage, tooManyAttemptsMessage } from '../../utils/errorCatalog';
import { copy } from '../../constants/copy';
import { LightColors } from '../../constants/colors';

interface ForgotPasswordFormData {
  email: string;
}

/**
 * Step 1 of 2 of "Forgot password": ask for the email. The server always
 * answers with the same generic success (it never says whether an account
 * exists) and, when one does, emails a 6-DIGIT code — which reset-password
 * collects together with the new password. Nothing is sent as a link.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  // Login pre-fills this when the user tapped "Forgot password?" with an
  // email already typed — the most common way to reach this screen.
  const params = useLocalSearchParams<{ email?: string }>();
  const { contentMaxWidth } = useResponsive();
  const [loading, setLoading] = useState(false);

  const {
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    mode: 'onTouched',
    defaultValues: { email: params.email ?? '' },
  });
  // Pattern 9: the CTA waits for an email that passes the inline check.
  const emailValue = watch('email');
  const emailIssue = emailProblem(emailValue);
  const ctaReason = emailIssue
    ? (emailValue ?? '').trim()
      ? emailIssue
      : 'Enter the email on your account'
    : undefined;

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setLoading(true);
    const email = data.email.trim();
    try {
      await authService.forgotPassword(email);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // The code screen itself says what was sent and where.
      router.push({ pathname: '/(auth)/reset-password', params: { email } });
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
        message = tooManyAttemptsMessage(error);
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

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingTop: 24,
            width: '100%',
            maxWidth: contentMaxWidth,
            alignSelf: 'center',
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text
            accessibilityRole="header"
            className="text-[28px] font-montserrat-bold text-ink"
            style={{ letterSpacing: -0.4, lineHeight: 32 }}
          >
            Reset password
          </Text>
          <Text className="text-[15px] font-montserrat text-textSecondary mt-2 mb-8">
            Enter your email and we'll send you a 6-digit code to reset your password.
          </Text>

          <Controller
            control={control}
            name="email"
            rules={{ validate: asRule(emailProblem) }}
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
                onSubmitEditing={emailIssue ? undefined : handleSubmit(onSubmit)}
                error={errors.email?.message}
                valid={!emailIssue}
              />
            )}
          />

          <Button
            title="Send code"
            fullWidth
            size="lg"
            loading={loading}
            loadingTitle="Sending code…"
            disabled={!!emailIssue}
            disabledReason={ctaReason}
            onPress={handleSubmit(onSubmit)}
          />

          <View className="flex-row items-center justify-center mt-6 py-2">
            <Text className="text-[14px] font-montserrat text-textSecondary">
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
    </SafeAreaView>
  );
}
