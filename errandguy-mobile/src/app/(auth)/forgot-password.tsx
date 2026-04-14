import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ChevronLeft } from 'lucide-react-native';
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
      const status = error?.response?.status ?? error?.status;
      let message: string;
      if (!error?.response && !error?.status) {
        message = 'Unable to reach the server. Check your internet connection.';
      } else if (status === 429) {
        message = 'Too many attempts. Please wait a few minutes and try again.';
      } else if (status === 500 || (status && status >= 500)) {
        message = 'Something went wrong on our end. Please try again later.';
      } else {
        message =
          error?.response?.data?.message ||
          error?.response?.data?.errors?.email?.[0] ||
          error?.message ||
          'Something went wrong. Please try again.';
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

      <Pressable
        className="mt-2 ml-4 w-10 h-10 rounded-full items-center justify-center"
        onPress={() => router.back()}
      >
        <ChevronLeft size={24} color="#0F172A" strokeWidth={2} />
      </Pressable>

      {sent ? (
        <View className="flex-1 justify-center items-center px-8">
          <Text style={{ fontSize: 56, marginBottom: 20 }}>✉️</Text>
          <Text className="text-2xl font-montserrat-semi text-textPrimary mb-2 text-center">
            Check your email
          </Text>
          <Text className="text-sm font-montserrat text-textTertiary text-center mb-10">
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
          className="flex-1 px-6 pt-4"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Text className="text-[24px] font-montserrat-semi text-textPrimary mb-1 tracking-tight">
            Reset password
          </Text>
          <Text className="text-[15px] font-montserrat text-textTertiary mb-8">
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
                error={errors.email?.message}
              />
            )}
          />

          <Button
            title="Send Reset Link"
            loadingTitle="Sending.."
            fullWidth
            size="lg"
            loading={loading}
            onPress={handleSubmit(onSubmit)}
          />

          <View style={fs.linkRow}>
            <Text style={fs.linkText}>Remember your password?</Text>
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() => router.replace('/(auth)/login')}
              style={fs.linkBtn}
            >
              <Text style={fs.linkBtnText}>Login</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const fs = StyleSheet.create({
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#94A3B8',
  },
  linkBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  linkBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#0F172A',
  },
});
