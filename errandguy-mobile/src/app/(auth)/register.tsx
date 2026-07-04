import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ChevronLeft, Camera, Check } from 'lucide-react-native';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { PasswordStrengthIndicator } from '../../components/auth/PasswordStrengthIndicator';
import { useAuth } from '../../hooks/useAuth';
import { useImagePicker } from '../../hooks/useImagePicker';
import { userService } from '../../services/user.service';
import { authService } from '../../services/auth.service';
import { toast } from '../../stores/toastStore';
import { LightColors } from '../../constants/colors';

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
      toast.error('Please accept the Terms of Service and Privacy Policy.');
      return;
    }

    setLoading(true);
    try {
      await register({
        full_name: data.full_name,
        phone: data.phone || undefined,
        email: data.email || undefined,
        password: data.password,
      });

      // Upload avatar if selected. Best-effort — we don't want a flaky
      // upload to block account creation, but we DO want to surface a
      // toast so the user knows their photo isn't on file and can retry
      // from the profile screen later.
      if (image) {
        const formData = new FormData();
        const ext = image.uri.split('.').pop()?.toLowerCase() || 'jpg';
        const mime =
          ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        formData.append('avatar', {
          uri: image.uri,
          name: `avatar.${ext === 'jpeg' ? 'jpg' : ext}`,
          type: mime,
        } as any);
        try {
          await userService.uploadAvatar(formData);
        } catch {
          toast.warning('Profile photo upload failed — you can add it later from your profile.');
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
      const status = error?.status;
      const serverErrors = error?.errors;

      if (serverErrors && typeof serverErrors === 'object') {
        let hasFieldError = false;
        for (const [field, messages] of Object.entries(serverErrors)) {
          if (field === 'phone' || field === 'email' || field === 'full_name' || field === 'password') {
            setError(field as keyof RegisterFormData, {
              message: (messages as string[])[0],
            });
            hasFieldError = true;
          }
        }
        if (!hasFieldError) {
          toast.error(error?.message || 'Registration failed. Please try again.');
        }
      } else {
        let message: string;
        if (!status) {
          message = 'Unable to reach the server. Check your internet connection.';
        } else if (status === 429) {
          message = 'Too many attempts. Please wait a few minutes and try again.';
        } else if (status >= 500) {
          message = 'Something went wrong on our end. Please try again later.';
        } else {
          message = error?.message || 'Registration failed. Please try again.';
        }
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Light airy hero — same flat background pattern as login. */}
          <View className="bg-background" style={rs.heroBlock}>
            <SafeAreaView edges={['top']}>
              <View className="px-6 pt-2 pb-9">
                <Pressable
                  style={rs.backBtn}
                  onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}
                >
                  <ChevronLeft size={22} color={LightColors.ink} strokeWidth={2.2} />
                </Pressable>
                <Text
                  className="text-[11px] font-montserrat-bold uppercase mt-6 text-primary"
                  style={{ letterSpacing: 1.8 }}
                >
                  Get started
                </Text>
                <Text
                  className="text-[26px] font-montserrat-bold text-ink tracking-tight mt-2"
                  style={{ lineHeight: 30 }}
                >
                  Create your account.
                </Text>
                <Text className="text-[13px] font-montserrat mt-2 text-textSecondary">
                  Let’s set up your profile
                </Text>
              </View>
            </SafeAreaView>
          </View>

          {/* Form card lifts over the hero's curved bottom edge. */}
          <View
            className="flex-1 bg-surface px-6 pt-7"
            style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -22 }}
          >

          {/* Avatar Upload */}
          <Pressable className="self-center mb-6" onPress={pickImage}>
            <View className="w-24 h-24 rounded-full bg-primaryLight items-center justify-center overflow-hidden border-2 border-primary">
              {image ? (
                <Image source={{ uri: image.uri }} className="w-full h-full" />
              ) : (
                <Camera size={28} color={LightColors.primary} />
              )}
            </View>
            <Text className="text-xs font-montserrat-semi text-primary text-center mt-1">
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
                autoComplete="tel"
                textContentType="telephoneNumber"
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
                autoComplete="email"
                textContentType="emailAddress"
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
                  autoComplete="new-password"
                  textContentType="newPassword"
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
                autoComplete="new-password"
                textContentType="newPassword"
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
                <Check size={14} color={LightColors.textInverse} strokeWidth={3} />
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

          <View style={rs.loginRow}>
            <Text style={rs.loginText}>Have an account?</Text>
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() => router.push('/(auth)/login')}
              style={rs.loginBtn}
            >
              <Text style={rs.loginBtnText}>Login</Text>
            </TouchableOpacity>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const rs = StyleSheet.create({
  heroBlock: {
    // Background colour lives on the className — this wrapper just
    // constrains the bottom radius so the form card can lift over a
    // clean curved edge (same seam treatment as login).
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
    backgroundColor: LightColors.divider,
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    marginBottom: 32,
    paddingVertical: 8,
  },
  loginText: {
    fontSize: 14,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textMuted,
  },
  loginBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  loginBtnText: {
    fontSize: 14,
    fontFamily: 'Quicksand_600SemiBold',
    color: LightColors.primary,
  },
});
