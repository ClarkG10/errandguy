import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { OTPInput } from '../../components/ui/OTPInput';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { useCountdown } from '../../hooks/useCountdown';
import { authService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/authStore';

export default function VerifyOTPScreen() {
  const router = useRouter();
  const { phone, email, purpose } = useLocalSearchParams<{
    phone?: string;
    email?: string;
    purpose?: string;
  }>();

  const { setUser, setToken } = useAuthStore();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);
  const [toast, setToast] = useState<{ visible: boolean; message: string; variant: 'success' | 'error' | 'info' | 'warning' }>({ visible: false, message: '', variant: 'error' });

  const { seconds, isExpired, start, reset, formatted } = useCountdown(300, true);

  const identifier = phone || email || '';
  const maskedIdentifier = phone
    ? phone.replace(/(\d{4})\d{4}(\d{3})/, '$1****$2')
    : email
      ? email.replace(/(.{2})(.*)(@.*)/, '$1***$3')
      : '';

  const handleVerify = useCallback(async () => {
    if (code.length !== 6) return;
    setLoading(true);
    try {
      const payload = phone ? { phone, code } : { email, code };
      const response = await authService.verifyOTP(payload);
      const data = response.data;

      if (data.user && data.token) {
        await setToken(data.token);
        setUser(data.user);
      }

      if (purpose === 'register-verify') {
        router.replace('/(auth)/role-select');
      } else {
        // Login flow — user + token already set, root layout will redirect
      }
    } catch (error: any) {
      const remaining = error?.response?.data?.attempts_remaining;
      if (remaining !== undefined) {
        setAttemptsRemaining(remaining);
      }
      const message =
        error?.response?.data?.message || 'Verification failed. Please try again.';
      setToast({ visible: true, message, variant: 'error' });
      setCode('');
    } finally {
      setLoading(false);
    }
  }, [code, phone, email, purpose, setToken, setUser, router]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6) {
      handleVerify();
    }
  }, [code, handleVerify]);

  const handleResend = async () => {
    try {
      const payload = phone ? { phone } : { email };
      await authService.sendOTP(payload);
      reset(300);
      start();
      setAttemptsRemaining(5);
      setToast({ visible: true, message: 'Code resent successfully.', variant: 'success' });
    } catch (error: any) {
      const message =
        error?.response?.data?.message || 'Failed to resend code. Please try again later.';
      setToast({ visible: true, message, variant: 'error' });
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

      <Text className="text-2xl font-montserrat-bold text-textPrimary mb-1">
        Verify your {phone ? 'number' : 'email'}
      </Text>
      <Text className="text-base font-montserrat text-textSecondary mb-8">
        We sent a 6-digit code to {maskedIdentifier}
      </Text>

      <OTPInput value={code} onChange={setCode} />

      <View className="items-center mt-6 mb-6">
        {!isExpired ? (
          <Text className="text-sm font-montserrat text-textSecondary">
            Resend code in {formatted}
          </Text>
        ) : (
          <Pressable onPress={handleResend}>
            <Text className="text-sm font-montserrat text-textSecondary">
              Didn't receive it?{' '}
              <Text className="text-primary font-montserrat-bold">Resend</Text>
            </Text>
          </Pressable>
        )}
      </View>

      {attemptsRemaining < 5 && (
        <Text className="text-xs font-montserrat text-danger text-center mb-4">
          {attemptsRemaining > 0
            ? `${attemptsRemaining} attempts remaining`
            : 'Too many attempts. Please request a new code.'}
        </Text>
      )}

      <Button
        title="Verify"
        fullWidth
        size="lg"
        loading={loading}
        disabled={code.length !== 6 || attemptsRemaining === 0}
        onPress={handleVerify}
      />
    </SafeAreaView>
  );
}
