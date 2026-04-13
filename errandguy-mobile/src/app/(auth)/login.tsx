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
import { ArrowLeft } from 'lucide-react-native';
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
  const { login } = useAuth();
  const [mode, setMode] = useState<LoginMode>('phone');
  const [loading, setLoading] = useState(false);
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
          contentContainerStyle={{ paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            cssInterop={false}
            style={s.backBtn}
            activeOpacity={0.6}
            onPress={() => router.back()}
          >
            <ArrowLeft size={20} color="#0F172A" />
          </TouchableOpacity>

          <Text className="text-xl font-montserrat-bold text-textPrimary mb-1">
            Welcome back
          </Text>
          <Text className="text-sm font-montserrat text-textTertiary mb-6">
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
  backBtn: {
    marginTop: 8,
    marginBottom: 24,
    alignSelf: 'flex-start',
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#2563EB',
  },
  tabText: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: '#64748B',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 24, padding: 4 },
  forgotText: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#2563EB' },
  signupLink: { alignItems: 'center', marginTop: 24, marginBottom: 32, padding: 8 },
  signupText: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: '#64748B' },
  signupBold: { color: '#2563EB', fontFamily: 'Poppins_700Bold' },
});
