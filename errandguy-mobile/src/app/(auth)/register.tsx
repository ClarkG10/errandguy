import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ArrowLeft, User, Smartphone, Mail, Lock, Camera, MapPin } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { PasswordStrengthIndicator } from '../../components/auth/PasswordStrengthIndicator';
import { useAuth } from '../../hooks/useAuth';
import { useImagePicker } from '../../hooks/useImagePicker';
import { userService } from '../../services/user.service';
import { authService } from '../../services/auth.service';

interface RegisterFormData {
  full_name: string;
  phone: string;
  email: string;
  password: string;
  confirm_password: string;
  default_address: string;
  terms: boolean;
}

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const { image, pickImage } = useImagePicker();
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', variant: 'error' as const });

  const {
    control,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<RegisterFormData>({
    defaultValues: {
      full_name: '',
      phone: '',
      email: '',
      password: '',
      confirm_password: '',
      default_address: '',
    },
  });

  const password = watch('password');

  const onSubmit = async (data: RegisterFormData) => {
    if (!termsAccepted) {
      setToast({
        visible: true,
        message: 'Please accept the Terms of Service and Privacy Policy.',
        variant: 'error',
      });
      return;
    }

    setLoading(true);
    try {
      await register({
        full_name: data.full_name,
        phone: data.phone || undefined,
        email: data.email || undefined,
        password: data.password,
        role: 'customer', // Temporary — role-select screen will update
      });

      // Upload avatar if selected
      if (image) {
        const formData = new FormData();
        formData.append('avatar', {
          uri: image.uri,
          name: 'avatar.jpg',
          type: 'image/jpeg',
        } as any);
        try {
          await userService.uploadAvatar(formData);
        } catch {
          // Non-critical — continue
        }
      }

      // Send OTP for phone verification
      if (data.phone) {
        try {
          await authService.sendOTP({ phone: data.phone });
          router.replace({
            pathname: '/(auth)/verify-otp',
            params: { phone: data.phone, purpose: 'register-verify' },
          });
        } catch {
          router.replace('/(auth)/role-select');
        }
      } else {
        router.replace('/(auth)/role-select');
      }
    } catch (error: any) {
      const serverErrors = error?.response?.data?.errors;
      if (serverErrors) {
        for (const [field, messages] of Object.entries(serverErrors)) {
          if (field === 'phone' || field === 'email' || field === 'full_name' || field === 'password') {
            setError(field as keyof RegisterFormData, {
              message: (messages as string[])[0],
            });
          }
        }
      } else {
        const message =
          error?.response?.data?.message || 'Registration failed. Please try again.';
        setToast({ visible: true, message, variant: 'error' });
      }
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
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable className="mt-2 mb-6" onPress={() => router.back()}>
            <ArrowLeft size={24} color="#0F172A" />
          </Pressable>

          <Text className="text-2xl font-montserrat-bold text-textPrimary mb-1">
            Create your account
          </Text>
          <Text className="text-base font-montserrat text-textSecondary mb-6">
            Let's set up your profile
          </Text>

          {/* Avatar Upload */}
          <Pressable className="self-center mb-6" onPress={pickImage}>
            <View className="w-24 h-24 rounded-full bg-primaryLight items-center justify-center overflow-hidden border-2 border-primary">
              {image ? (
                <Image source={{ uri: image.uri }} className="w-full h-full" />
              ) : (
                <Camera size={32} color="#2563EB" />
              )}
            </View>
            <Text className="text-xs font-montserrat text-primary text-center mt-1">
              Add Photo
            </Text>
          </Pressable>

          {/* Form Fields */}
          <Controller
            control={control}
            name="full_name"
            rules={{
              required: 'Full name is required',
              maxLength: { value: 100, message: 'Maximum 100 characters' },
            }}
            render={({ field: { onChange, value } }) => (
              <Input
                label="Full Name"
                value={value}
                onChangeText={onChange}
                placeholder="Juan Dela Cruz"
                leftIcon={User}
                error={errors.full_name?.message}
              />
            )}
          />

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

          <Controller
            control={control}
            name="password"
            rules={{
              required: 'Password is required',
              minLength: { value: 8, message: 'Minimum 8 characters' },
              validate: (value) => {
                if (!/[A-Z]/.test(value)) return 'Must contain an uppercase letter';
                if (!/[a-z]/.test(value)) return 'Must contain a lowercase letter';
                if (!/\d/.test(value)) return 'Must contain a number';
                if (!/[!@#$%^&*(),.?":{}|<>]/.test(value))
                  return 'Must contain a special character';
                return true;
              },
            }}
            render={({ field: { onChange, value } }) => (
              <>
                <Input
                  label="Password"
                  value={value}
                  onChangeText={onChange}
                  placeholder="Create a strong password"
                  secureTextEntry
                  leftIcon={Lock}
                  error={errors.password?.message}
                />
                <PasswordStrengthIndicator password={value} />
              </>
            )}
          />

          <Controller
            control={control}
            name="confirm_password"
            rules={{
              required: 'Please confirm your password',
              validate: (value) =>
                value === password || 'Passwords do not match',
            }}
            render={({ field: { onChange, value } }) => (
              <Input
                label="Confirm Password"
                value={value}
                onChangeText={onChange}
                placeholder="Confirm your password"
                secureTextEntry
                leftIcon={Lock}
                error={errors.confirm_password?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="default_address"
            render={({ field: { onChange, value } }) => (
              <Input
                label="Default Address (Optional)"
                value={value}
                onChangeText={onChange}
                placeholder="Enter your address"
                leftIcon={MapPin}
              />
            )}
          />

          {/* Terms Checkbox */}
          <Pressable
            className="flex-row items-start mb-6"
            onPress={() => setTermsAccepted(!termsAccepted)}
          >
            <View
              className={`w-5 h-5 rounded border mr-3 mt-0.5 items-center justify-center ${
                termsAccepted ? 'bg-primary border-primary' : 'border-divider'
              }`}
            >
              {termsAccepted && (
                <Text className="text-white text-xs font-montserrat-bold">✓</Text>
              )}
            </View>
            <Text className="flex-1 text-sm font-montserrat text-textSecondary">
              I agree to the{' '}
              <Text className="text-primary">Terms of Service</Text> and{' '}
              <Text className="text-primary">Privacy Policy</Text>
            </Text>
          </Pressable>

          <Button
            title="Create Account"
            fullWidth
            size="lg"
            loading={loading}
            disabled={!termsAccepted}
            onPress={handleSubmit(onSubmit)}
          />

          <Pressable
            className="items-center mt-4 mb-8"
            onPress={() => router.push('/(auth)/login')}
          >
            <Text className="text-sm font-montserrat text-textSecondary">
              Already have an account?{' '}
              <Text className="text-primary font-montserrat-bold">Log In</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
