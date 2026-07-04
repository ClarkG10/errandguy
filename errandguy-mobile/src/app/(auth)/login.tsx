import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ChevronLeft, Check } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { SocialLoginButton } from '../../components/auth/SocialLoginButton';
import { AuthBrandMark } from '../../components/auth/OnboardingIllustrations';
import { LogoutSplash } from '../../components/ui/LogoutSplash';
import { useAuth } from '../../hooks/useAuth';
import { preloadCoreImages } from '../../services/preload.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { LightColors } from '../../constants/colors';

interface LoginFormData {
  identifier: string;
  password: string;
}

const isPhone = (val: string) => /^(\+63|0)9\d{9}$/.test(val.trim());
const isEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const onboardingSeen = useAuthStore((s) => s.onboardingSeen);
  const rememberedCredentials = useAuthStore((s) => s.rememberedCredentials);
  const setRememberedCredentials = useAuthStore((s) => s.setRememberedCredentials);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(!!rememberedCredentials);

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<LoginFormData>({
    defaultValues: { identifier: '', password: '' },
  });

  useEffect(() => {
    if (rememberedCredentials?.identifier) {
      reset({ identifier: rememberedCredentials.identifier, password: '' });
    }
  }, [rememberedCredentials, reset]);

  useEffect(() => {
    preloadCoreImages().catch(() => {});
  }, []);

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const id = data.identifier.trim();
      const loginData = isPhone(id)
        ? { phone: id, password: data.password }
        : { email: id, password: data.password };
      await login(loginData);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (rememberMe) {
        await setRememberedCredentials({ identifier: id });
      } else {
        await setRememberedCredentials(null);
      }
    } catch (error: any) {
      const status = error?.status;
      let message: string;
      if (!status) {
        message = 'Unable to reach the server. Check your internet connection.';
      } else if (status === 401) {
        message = 'Incorrect credentials. Please check and try again.';
      } else if (status === 405) {
        message = 'Service temporarily unavailable. Please try again later.';
      } else if (status >= 500) {
        message = 'Something went wrong on our end. Please try again later.';
      } else if (status === 429) {
        message = 'Too many attempts. Please wait a few minutes and try again.';
      } else if (status === 422) {
        message =
          error.errors?.credentials?.[0] ||
          error.errors?.status?.[0] ||
          error.message ||
          'Invalid credentials. Please check and try again.';
      } else {
        message = error.message || 'Login failed. Please try again.';
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back (only when arriving from onboarding) */}
          {!onboardingSeen && (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
              hitSlop={10}
              className="w-10 h-10 rounded-full items-center justify-center bg-surface mt-2"
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ChevronLeft size={22} color={LightColors.ink} strokeWidth={2.2} />
            </Pressable>
          )}

          {/* Brand + heading — simple, left-aligned, generous whitespace. */}
          <View className="mt-8 mb-8">
            <AuthBrandMark size={56} tintColor={LightColors.primary} />
            <Text className="text-[28px] font-montserrat-bold text-ink mt-6" style={{ letterSpacing: -0.4 }}>
              Welcome back
            </Text>
            <Text className="text-[15px] font-montserrat text-textSecondary mt-1.5">
              Sign in to continue your errand.
            </Text>
          </View>

          {/* Fields */}
          <Controller
            control={control}
            name="identifier"
            rules={{
              required: 'Phone or email is required',
              validate: (val) => isPhone(val) || isEmail(val) || 'Enter a valid phone or email',
            }}
            render={({ field: { onChange, value } }) => {
              const looksLikePhone = value.length > 0 && /^[+0-9]/.test(value);
              return (
                <Input
                  label="Phone or Email"
                  value={value}
                  onChangeText={onChange}
                  placeholder="09XXXXXXXXX or you@email.com"
                  keyboardType={looksLikePhone ? 'phone-pad' : 'email-address'}
                  autoCapitalize="none"
                  autoComplete={looksLikePhone ? 'tel' : 'email'}
                  textContentType={looksLikePhone ? 'telephoneNumber' : 'emailAddress'}
                  error={errors.identifier?.message}
                />
              );
            }}
          />

          <Controller
            control={control}
            name="password"
            rules={{
              required: 'Password is required',
              minLength: { value: 8, message: 'At least 8 characters' },
            }}
            render={({ field: { onChange, value } }) => (
              <Input
                label="Password"
                value={value}
                onChangeText={onChange}
                placeholder="Enter your password"
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                error={errors.password?.message}
              />
            )}
          />

          {/* Remember + forgot */}
          <View className="flex-row items-center justify-between mt-1 mb-6">
            <Pressable className="flex-row items-center" onPress={() => setRememberMe(!rememberMe)} hitSlop={8}>
              <View
                className="w-5 h-5 rounded-md items-center justify-center border"
                style={{
                  backgroundColor: rememberMe ? LightColors.primary : LightColors.surface,
                  borderColor: rememberMe ? LightColors.primary : LightColors.dividerStrong,
                }}
              >
                {rememberMe && <Check size={12} color={LightColors.textInverse} strokeWidth={3} />}
              </View>
              <Text className="text-[13px] font-montserrat text-textTertiary ml-2">Remember me</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/(auth)/forgot-password')} hitSlop={8}>
              <Text className="text-[13px] font-montserrat-semi text-primary">Forgot password?</Text>
            </Pressable>
          </View>

          {/* Primary CTA */}
          <Button title="Log in" fullWidth size="lg" loading={loading} onPress={handleSubmit(onSubmit)} />

          {/* Divider */}
          <View className="flex-row items-center my-6">
            <View className="flex-1 h-px bg-divider" />
            <Text className="text-[12px] font-montserrat text-textMuted mx-3">or continue with</Text>
            <View className="flex-1 h-px bg-divider" />
          </View>

          {/* Social */}
          <View className="flex-row" style={{ gap: 12 }}>
            <SocialLoginButton
              provider="google"
              onPress={() =>
                toast.info('Google sign-in is being finalized. Please use your phone or email for now.')
              }
            />
            <SocialLoginButton
              provider="facebook"
              onPress={() =>
                toast.info('Facebook sign-in is being finalized. Please use your phone or email for now.')
              }
            />
          </View>

          {/* Sign up */}
          <View className="flex-row items-center justify-center mt-auto pt-8 pb-2">
            <Text className="text-[14px] font-montserrat text-textMuted">New here? </Text>
            <Pressable onPress={() => router.push('/(auth)/register')} hitSlop={8}>
              <Text className="text-[14px] font-montserrat-bold text-primary">Create account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LogoutSplash
        visible={loading}
        backgroundColor={LightColors.primaryDark}
        logoTintColor={LightColors.textInverse}
        logoSize={172}
      />
    </SafeAreaView>
  );
}
