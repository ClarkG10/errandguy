import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { authService } from '../../services/auth.service';

interface ForgotPasswordFormData {
  email: string;
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', variant: 'error' as const });

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    defaultValues: { email: '' },
  });

  const onSubmit = async (data: ForgotPasswordFormData) => {
    setLoading(true);
    try {
      await authService.forgotPassword(data.email);
      setSent(true);
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.response?.data?.errors?.email?.[0] ||
        'Something went wrong. Please try again.';
      setToast({ visible: true, message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface px-6">
      <Toast
        message={toast.message}
        variant={toast.variant}
        visible={toast.visible}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />

      <Pressable className="mt-2 mb-6" onPress={() => router.back()}>
        <ArrowLeft size={24} color="#0F172A" />
      </Pressable>

      {sent ? (
        <View className="flex-1 justify-center items-center">
          <View className="w-16 h-16 rounded-full bg-primaryLight items-center justify-center mb-4">
            <CheckCircle size={32} color="#2563EB" />
          </View>
          <Text className="text-2xl font-montserrat-bold text-textPrimary mb-2 text-center">
            Check your email
          </Text>
          <Text className="text-base font-montserrat text-textSecondary text-center mb-8">
            We've sent a password reset link to your email. Please check your inbox.
          </Text>
          <Button
            title="Back to Login"
            fullWidth
            size="lg"
            onPress={() => router.replace('/(auth)/login')}
          />
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Text className="text-2xl font-montserrat-bold text-textPrimary mb-1">
            Reset password
          </Text>
          <Text className="text-base font-montserrat text-textSecondary mb-6">
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

          <Button
            title="Send Reset Link"
            fullWidth
            size="lg"
            loading={loading}
            onPress={handleSubmit(onSubmit)}
          />

          <Pressable
            className="items-center mt-6"
            onPress={() => router.replace('/(auth)/login')}
          >
            <Text className="text-sm font-montserrat text-textSecondary">
              Remember your password?{' '}
              <Text className="text-primary font-montserrat-bold">Back to Login</Text>
            </Text>
          </Pressable>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
