import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ArrowLeft, Smartphone, Mail, Lock } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { SocialLoginButton } from '../../components/auth/SocialLoginButton';
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
          <Pressable className="mt-2 mb-6" onPress={() => router.back()}>
            <ArrowLeft size={24} color="#0F172A" />
          </Pressable>

          <Text className="text-2xl font-montserrat-bold text-textPrimary mb-1">
            Welcome back
          </Text>
          <Text className="text-base font-montserrat text-textSecondary mb-6">
            Log in to your account
          </Text>

          {/* Mode toggle */}
          <View className="flex-row bg-background rounded-xl p-1 mb-6">
            <Pressable
              className={`flex-1 py-2.5 rounded-lg items-center ${mode === 'phone' ? 'bg-surface shadow-sm' : ''}`}
              onPress={() => setMode('phone')}
            >
              <Text
                className={`text-sm font-montserrat-bold ${mode === 'phone' ? 'text-primary' : 'text-textSecondary'}`}
              >
                Phone
              </Text>
            </Pressable>
            <Pressable
              className={`flex-1 py-2.5 rounded-lg items-center ${mode === 'email' ? 'bg-surface shadow-sm' : ''}`}
              onPress={() => setMode('email')}
            >
              <Text
                className={`text-sm font-montserrat-bold ${mode === 'email' ? 'text-primary' : 'text-textSecondary'}`}
              >
                Email
              </Text>
            </Pressable>
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

          <Pressable
            className="self-end mb-6"
            onPress={() => router.push('/(auth)/forgot-password')}
          >
            <Text className="text-sm font-montserrat text-primary">
              Forgot password?
            </Text>
          </Pressable>

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

          {/* Social Login */}
          <View className="flex-row gap-3 mb-6">
            <SocialLoginButton
              provider="google"
              onPress={() => handleSocialLogin('google')}
              loading={socialLoading === 'google'}
            />
            <SocialLoginButton
              provider="facebook"
              onPress={() => handleSocialLogin('facebook')}
              loading={socialLoading === 'facebook'}
            />
          </View>

          <Pressable
            className="items-center mb-8"
            onPress={() => router.push('/(auth)/register')}
          >
            <Text className="text-sm font-montserrat text-textSecondary">
              Don't have an account?{' '}
              <Text className="text-primary font-montserrat-bold">Sign Up</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
