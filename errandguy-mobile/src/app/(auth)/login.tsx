import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ChevronLeft } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { SocialLoginButton } from '../../components/auth/SocialLoginButton';
import { useAuth } from '../../hooks/useAuth';
import { useAuthStore } from '../../stores/authStore';

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
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: 'success' | 'error' | 'info' | 'warning' }>({ visible: false, message: '', variant: 'error' });

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const id = data.identifier.trim();
      const loginData = isPhone(id)
        ? { phone: id, password: data.password }
        : { email: id, password: data.password };
      await login(loginData);
    } catch (error: any) {
      const status = error?.response?.status;
      let message: string;

      if (!error?.response) {
        message = 'Unable to reach the server. Check your internet connection.';
      } else if (status === 405) {
        message = 'Service temporarily unavailable. Please try again later.';
      } else if (status === 500) {
        message = 'Something went wrong on our end. Please try again later.';
      } else if (status === 429) {
        message = 'Too many attempts. Please wait a few minutes and try again.';
      } else if (status === 422) {
        message =
          error.response.data?.message ||
          error.response.data?.errors?.credentials?.[0] ||
          error.response.data?.errors?.status?.[0] ||
          'Invalid credentials. Please check and try again.';
      } else {
        message =
          error.response?.data?.message || 'Login failed. Please try again.';
      }

      setToast({ visible: true, message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <Toast
        message={toast.message}
        variant={toast.variant}
        visible={toast.visible}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back — only show if onboarding not yet completed */}
          {!onboardingSeen && (
            <TouchableOpacity
              cssInterop={false}
              style={s.backBtn}
              activeOpacity={0.6}
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/welcome')}
            >
              <ChevronLeft size={24} color="#0F172A" strokeWidth={2} />
            </TouchableOpacity>
          )}
          {onboardingSeen && <View style={{ height: 48 }} />}

          {/* Header */}
          <Text className="text-[28px] font-montserrat-bold text-textPrimary mb-1 tracking-tight">
            Welcome back
          </Text>
          <Text className="text-[15px] font-montserrat text-textTertiary mb-10">
            Sign in with your phone number or email
          </Text>

          {/* Identifier — auto-detects phone or email */}
          <Controller
            control={control}
            name="identifier"
            rules={{
              required: 'Phone or email is required',
              validate: (val) =>
                isPhone(val) || isEmail(val) || 'Enter a valid phone or email',
            }}
            render={({ field: { onChange, value } }) => (
              <Input
                label="Phone or Email"
                value={value}
                onChangeText={onChange}
                placeholder="09XXXXXXXXX or you@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                error={errors.identifier?.message}
              />
            )}
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
                error={errors.password?.message}
              />
            )}
          />

          <TouchableOpacity
            cssInterop={false}
            style={s.forgotBtn}
            activeOpacity={0.6}
            onPress={() => router.push('/(auth)/forgot-password')}
          >
            <Text cssInterop={false} style={s.forgotText}>
              Forgot password?
            </Text>
          </TouchableOpacity>

          <Button
            title="Login"
            loadingTitle="Logging in.."
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  backBtn: {
    marginTop: 8,
    marginBottom: 32,
    alignSelf: 'flex-start',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 28, padding: 4 },
  forgotText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#2563EB' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E2E8F0' },
  dividerText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_400Regular',
    color: '#94A3B8',
  },
  signupBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  signupBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#0F172A',
  },
});
