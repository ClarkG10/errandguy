import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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

  // Pre-fill remembered identifier (NEVER password — see authStore).
  useEffect(() => {
    if (rememberedCredentials?.identifier) {
      reset({
        identifier: rememberedCredentials.identifier,
        password: '',
      });
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

      // Success haptic — a satisfying confirmation that's standard
      // on iOS banking / fintech apps. Quiet failures are forgivable;
      // a quiet success makes the app feel slow.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      // Save or clear remembered identifier (no password).
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
    <View className="flex-1 bg-white">
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand hero — soft three-stop gradient with the brand
              mark centred. Replaces the previous flat blue block,
              which read as a stark header band. The gradient + mark
              gives the screen a recognisable identity moment without
              stealing focus from the form below. */}
          <LinearGradient
            colors={['#1E40AF', '#2563EB', '#3B82F6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.heroBlock}
          >
            <SafeAreaView edges={['top']}>
              <View className="px-6 pt-2 pb-9">
                {!onboardingSeen && (
                  <TouchableOpacity
                    cssInterop={false}
                    style={s.backBtn}
                    activeOpacity={0.6}
                    onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/welcome')}
                  >
                    <ChevronLeft size={22} color="#FFFFFF" strokeWidth={2.2} />
                  </TouchableOpacity>
                )}
                {onboardingSeen && <View style={{ height: 12 }} />}

                <View className="items-center mt-2">
                  <AuthBrandMark size={92} tintColor="#FFFFFF" />
                </View>

                <Text
                  className="text-[11px] font-montserrat-bold uppercase text-center mt-4"
                  style={{ letterSpacing: 1.8, color: 'rgba(255,255,255,0.85)' }}
                >
                  ErrandGuy
                </Text>
                <Text
                  className="text-[24px] font-montserrat-bold text-white tracking-tight text-center mt-1.5"
                  style={{ lineHeight: 28 }}
                >
                  Welcome back.
                </Text>
                <Text
                  className="text-[13px] font-montserrat text-center mt-1.5"
                  style={{ color: 'rgba(255,255,255,0.85)' }}
                >
                  Sign in to continue your errand.
                </Text>
              </View>
            </SafeAreaView>
          </LinearGradient>

          {/* Form card — lifts up over the gradient bottom edge by
              22pt so the seam reads as a deliberate elevated surface
              rather than a flat join. */}
          <View
            className="flex-1 bg-white px-6 pt-7"
            style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -22 }}
          >

          {/* Identifier — auto-detects phone or email */}
          <Controller
            control={control}
            name="identifier"
            rules={{
              required: 'Phone or email is required',
              validate: (val) =>
                isPhone(val) || isEmail(val) || 'Enter a valid phone or email',
            }}
            render={({ field: { onChange, value } }) => {
              // Swap the keyboard the moment the user starts typing
              // digits or +63 — a phone-pad on a digits-first input is
              // both faster and a tactile cue that the field auto-detects.
              // Falls back to email-address keyboard otherwise so '@' / '.'
              // stay one tap away.
              const looksLikePhone =
                value.length > 0 && /^[+0-9]/.test(value);
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

          {/* Remember Me + Forgot Password row */}
          <View style={s.rememberRow}>
            <Pressable
              style={s.rememberBtn}
              onPress={() => setRememberMe(!rememberMe)}
              hitSlop={8}
            >
              <View style={[s.checkbox, rememberMe && s.checkboxChecked]}>
                {rememberMe && <Check size={12} color="#fff" strokeWidth={3} />}
              </View>
              <Text cssInterop={false} style={s.rememberText}>Remember me</Text>
            </Pressable>
            <TouchableOpacity
              cssInterop={false}
              activeOpacity={0.6}
              onPress={() => router.push('/(auth)/forgot-password')}
            >
              <Text cssInterop={false} style={s.forgotText}>
                Forgot password?
              </Text>
            </TouchableOpacity>
          </View>

          <Button
            title="Login"

            fullWidth
            size="lg"
            loading={loading}
            onPress={handleSubmit(onSubmit)}
          />

          {/* Social Login */}
          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text cssInterop={false} style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          <View style={s.socialRow}>
            <SocialLoginButton provider="google" onPress={() => {}} />
            <SocialLoginButton provider="facebook" onPress={() => {}} />
          </View>

          {/* Spacer pushes signup link toward bottom */}
          <View style={{ flex: 1 }} />

          <View style={s.signupRow}>
            <Text cssInterop={false} style={s.signupText}>New here?</Text>
            <TouchableOpacity
              cssInterop={false}
              activeOpacity={0.6}
              onPress={() => router.push('/(auth)/register')}
              style={s.signupBtn}
            >
              <Text cssInterop={false} style={s.signupBtnText}>Create account</Text>
            </TouchableOpacity>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LogoutSplash
        visible={loading}
        backgroundColor="#1D4ED8"
        logoTintColor="#FFFFFF"
        logoSize={172}
      />
    </View>
  );
}

const s = StyleSheet.create({
  heroBlock: {
    // Gradient styling lives on the LinearGradient props — this
    // wrapper just constrains the bottom radius so the form card
    // can lift over a clean curved edge.
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  forgotText: { fontSize: 13, fontFamily: 'Quicksand_500Medium', color: '#2563EB' },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
    marginTop: 4,
  },
  rememberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  rememberText: {
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: '#64748B',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E2E8F0' },
  dividerText: {
    fontSize: 13,
    fontFamily: 'Quicksand_400Regular',
    color: '#94A3B8',
    marginHorizontal: 16,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 32,
    paddingVertical: 8,
  },
  signupText: {
    fontSize: 14,
    fontFamily: 'Quicksand_400Regular',
    color: '#94A3B8',
  },
  signupBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  signupBtnText: {
    fontSize: 14,
    fontFamily: 'Quicksand_600SemiBold',
    color: '#0F172A',
  },
});
