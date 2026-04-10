import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ArrowLeft, Smartphone, Mail, Lock } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { useAuth } from '../../hooks/useAuth';

type LoginMode = 'phone' | 'email';

interface LoginFormData {
  phone: string;
  email: string;
  password: string;
}

export default function LoginScreen() {
  const router = useRouter();
  const { login, socialLogin } = useAuth();
  const [mode, setMode] = useState<LoginMode>('phone');
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'facebook' | null>(null);
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: 'success' | 'error' | 'info' | 'warning' }>({ visible: false, message: '', variant: 'error' });

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    defaultValues: { phone: '', email: '', password: '' },
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const loginData =
        mode === 'phone'
          ? { phone: data.phone, password: data.password }
          : { email: data.email, password: data.password };
      await login(loginData);
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.errors?.credentials?.[0] ||
        error?.response?.data?.errors?.status?.[0] ||
        'Login failed. Please try again.';
      setToast({ visible: true, message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'facebook') => {
    setSocialLoading(provider);
    try {
      // TODO: Integrate Google/Facebook SDK to get token
      setToast({
        visible: true,
        message: `${provider} login will be available soon.`,
        variant: 'info',
      });
    } catch (error: any) {
      setToast({
        visible: true,
        message: `${provider} login failed. Please try again.`,
        variant: 'error',
      });
    } finally {
      setSocialLoading(null);
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
          contentContainerStyle={{ paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            cssInterop={false}
            style={s.backBtn}
            activeOpacity={0.6}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color="#0F172A" />
          </TouchableOpacity>

          <Text className="text-2xl font-montserrat-bold text-textPrimary mb-1">
            Welcome back
          </Text>
          <Text className="text-base font-montserrat text-textSecondary mb-6">
            Log in to your account
          </Text>

          {/* Mode toggle */}
          <View style={s.toggleRow}>
            <TouchableOpacity
              cssInterop={false}
              style={[s.tab, mode === 'phone' && s.tabActive]}
              activeOpacity={0.7}
              onPress={() => setMode('phone')}
            >
              <Text
                cssInterop={false}
                style={[s.tabText, mode === 'phone' && s.tabTextActive]}
              >
                Phone
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              cssInterop={false}
              style={[s.tab, mode === 'email' && s.tabActive]}
              activeOpacity={0.7}
              onPress={() => setMode('email')}
            >
              <Text
                cssInterop={false}
                style={[s.tabText, mode === 'email' && s.tabTextActive]}
              >
                Email
              </Text>
            </TouchableOpacity>
          </View>

          {mode === 'phone' ? (
            <Controller
              control={control}
              name="phone"
              rules={{
                required: 'Phone number is required',
                pattern: {
                  value: /^(\+63|0)9\d{9}$/,
                  message: 'Enter a valid PH phone number',
                },
              }}
              render={({ field: { onChange, value } }) => (
                <Input
                  label="Phone Number"
                  value={value}
                  onChangeText={onChange}
                  placeholder="09XXXXXXXXX"
                  keyboardType="phone-pad"
                  leftIcon={Smartphone}
                  error={errors.phone?.message}
                />
              )}
            />
          ) : (
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
              render={({ field: { onChange, value } }) => (
                <Input
                  label="Email"
                  value={value}
                  onChangeText={onChange}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  leftIcon={Mail}
                  error={errors.email?.message}
                />
              )}
            />
          )}

          <Controller
            control={control}
            name="password"
            rules={{
              required: 'Password is required',
              minLength: { value: 8, message: 'Password must be at least 8 characters' },
            }}
            render={({ field: { onChange, value } }) => (
              <Input
                label="Password"
                value={value}
                onChangeText={onChange}
                placeholder="Enter your password"
                secureTextEntry
                leftIcon={Lock}
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
            title="Log In"
            fullWidth
            size="lg"
            loading={loading}
            onPress={handleSubmit(onSubmit)}
          />

          {/* Divider */}
          <View className="flex-row items-center my-6">
            <View className="flex-1 h-px bg-divider" />
            <Text className="mx-4 text-sm font-montserrat text-textSecondary">
              or continue with
            </Text>
            <View className="flex-1 h-px bg-divider" />
          </View>

          {/* Social Login — icon-only */}
          <View style={s.socialRow}>
            <TouchableOpacity
              cssInterop={false}
              style={s.socialBtn}
              activeOpacity={0.7}
              onPress={() => handleSocialLogin('google')}
              disabled={socialLoading === 'google'}
            >
              {socialLoading === 'google' ? (
                <ActivityIndicator size="small" color="#475569" />
              ) : (
                <Text cssInterop={false} style={s.googleLetter}>G</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              cssInterop={false}
              style={[s.socialBtn, s.fbBtn]}
              activeOpacity={0.7}
              onPress={() => handleSocialLogin('facebook')}
              disabled={socialLoading === 'facebook'}
            >
              {socialLoading === 'facebook' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text cssInterop={false} style={s.fbLetter}>f</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            cssInterop={false}
            style={s.signupLink}
            activeOpacity={0.6}
            onPress={() => router.push('/(auth)/register')}
          >
            <Text cssInterop={false} style={s.signupText}>
              Don't have an account?{' '}
              <Text cssInterop={false} style={s.signupBold}>Sign Up</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  backBtn: { marginTop: 8, marginBottom: 24, alignSelf: 'flex-start', padding: 4 },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontFamily: 'Lato_700Bold',
    color: '#475569',
  },
  tabTextActive: {
    color: '#2563EB',
  },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 24, padding: 4 },
  forgotText: { fontSize: 14, fontFamily: 'Lato_400Regular', color: '#2563EB' },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 24,
  },
  socialBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fbBtn: {
    backgroundColor: '#1877F2',
    borderColor: '#1877F2',
  },
  googleLetter: {
    fontSize: 22,
    fontFamily: 'Lato_700Bold',
    color: '#4285F4',
  },
  fbLetter: {
    fontSize: 22,
    fontFamily: 'Lato_700Bold',
    color: '#FFFFFF',
  },
  signupLink: { alignItems: 'center', marginBottom: 32, padding: 8 },
  signupText: { fontSize: 14, fontFamily: 'Lato_400Regular', color: '#475569' },
  signupBold: { color: '#2563EB', fontFamily: 'Lato_700Bold' },
});
