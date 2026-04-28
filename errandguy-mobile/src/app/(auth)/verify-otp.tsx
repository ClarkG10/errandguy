import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { OTPInput } from '../../components/ui/OTPInput';
import { Button } from '../../components/ui/Button';
import { useCountdown } from '../../hooks/useCountdown';
import { authService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';

export default function VerifyOTPScreen() {
  const router = useRouter();
  const { phone, email, purpose } = useLocalSearchParams<{
    phone?: string;
    email?: string;
    purpose?: string;
  }>();

  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);

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
      const remaining = error?.attempts_remaining;
      if (remaining !== undefined) {
        setAttemptsRemaining(remaining);
      }
      const message = error?.message || 'Verification failed. Please try again.';
      toast.error(message);
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
      toast.success('Code resent successfully.');
    } catch (error: any) {
      const message = error?.message || 'Failed to resend code. Please try again later.';
      toast.error(message);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <Pressable
        className="mt-2 ml-6 mb-8 w-10 h-10 rounded-full items-center justify-center"
        onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}
      >
        <ChevronLeft size={24} color="#0F172A" strokeWidth={2} />
      </Pressable>

      <View className="px-6">
      <Text className="text-[24px] font-montserrat-semi text-textPrimary mb-1 tracking-tight">
        Verify your {phone ? 'number' : 'email'}
      </Text>
      <Text className="text-[15px] font-montserrat text-textTertiary mb-10">
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
              <Text className="text-primary font-montserrat-semi">Resend</Text>
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
      </View>
    </SafeAreaView>
  );
}
