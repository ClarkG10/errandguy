import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Image,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller, type FieldErrors } from 'react-hook-form';
import { ChevronLeft, Camera, Check, MapPin, MapPinCheck } from 'lucide-react-native';
import { Input, type InputHandle } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { PasswordStrengthIndicator } from '../../components/auth/PasswordStrengthIndicator';
import { LegalModal, type LegalDocument } from '../../components/auth/LegalModal';
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { useImagePicker } from '../../hooks/useImagePicker';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';
import { userService } from '../../services/user.service';
import { authService } from '../../services/auth.service';
import { geocodingService, type PlaceFeature } from '../../services/geocoding.service';
import { toast } from '../../stores/toastStore';
import { errorMessage } from '../../utils/errorCatalog';
import { LightColors, Elevation } from '../../constants/colors';

interface RegisterFormData {
  full_name: string;
  phone: string;
  email: string;
  password: string;
  confirm_password: string;
  default_address: string;
  referral_code: string;
  terms: boolean;
}

/** Visual top-to-bottom field order — used to pick which invalid field
 *  to scroll to after a failed submit. */
const FIELD_ORDER = [
  'full_name',
  'phone',
  'email',
  'password',
  'confirm_password',
] as const;

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const { image, pickImage } = useImagePicker();
  const reducedMotion = useReducedMotion();
  const { contentMaxWidth } = useResponsive();
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocument | null>(null);
  const [showReferral, setShowReferral] = useState(false);

  // Return-key chaining — each field's "next" hands focus down the form.
  const phoneRef = useRef<InputHandle>(null);
  const emailRef = useRef<InputHandle>(null);
  const passwordRef = useRef<InputHandle>(null);
  const confirmPasswordRef = useRef<InputHandle>(null);
  const addressRef = useRef<InputHandle>(null);

  // Scroll-to-first-error plumbing: the CTA sits below the fold of the
  // top fields, so a failed submit must bring the offending field back
  // on screen or the tap appears to do nothing. Field y-positions are
  // relative to the form card, which is itself offset in the scroll
  // content — both are captured via onLayout.
  const scrollRef = useRef<ScrollView>(null);
  const cardY = useRef(0);
  const fieldY = useRef<Record<string, number>>({});
  const termsErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (termsErrorTimer.current) clearTimeout(termsErrorTimer.current);
    },
    [],
  );

  const scrollToField = (key: string) => {
    scrollRef.current?.scrollTo({
      y: Math.max(0, cardY.current + (fieldY.current[key] ?? 0) - 12),
      animated: !reducedMotion,
    });
  };

  const {
    control,
    handleSubmit,
    watch,
    setError,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormData>({
    // Validate on first blur, then live on every change — errors appear
    // once the user leaves a field rather than only on submit.
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: {
      full_name: '',
      phone: '',
      email: '',
      password: '',
      confirm_password: '',
      default_address: '',
      referral_code: '',
    },
  });

  const password = watch('password');

  /* ── Default-address autocomplete ──
     Debounced HERE geocoding search (same pattern as the saved-addresses
     screen). Selecting a result captures coordinates so the address can
     be created as a real saved address after registration. */
  const [addressResults, setAddressResults] = useState<PlaceFeature[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<PlaceFeature | null>(null);
  const addressValue = watch('default_address');
  const debouncedAddress = useDebounce(addressValue, 400);

  useEffect(() => {
    const q = (debouncedAddress ?? '').trim();
    // Skip searching when empty/short or when the field still shows the
    // exact place the user already picked.
    if (q.length < 2 || q === selectedAddress?.place_name) {
      setAddressResults([]);
      return;
    }
    let cancelled = false;
    geocodingService.search(q, 5).then((features) => {
      if (!cancelled) setAddressResults(features);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedAddress, selectedAddress]);

  const handleAddressSelect = (item: PlaceFeature) => {
    Haptics.selectionAsync().catch(() => {});
    setValue('default_address', item.place_name);
    setSelectedAddress(item);
    setAddressResults([]);
    Keyboard.dismiss();
  };

  // "Pinned" = the field still exactly matches the geocoded pick, so we
  // have real coordinates and will save it as a Home address post-signup.
  // Editing away from the pick drops the pin (and the saved-address
  // benefit) — the UI must signal that downgrade honestly.
  const addressPinned =
    !!selectedAddress && addressValue?.trim() === selectedAddress.place_name;

  const handlePickAvatar = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    pickImage();
  };

  /** Client-side validation failed — error haptic + scroll the first
   *  invalid field back into view so the failed tap is never silent. */
  const onInvalid = (errs: FieldErrors<RegisterFormData>) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (first) scrollToField(first);
  };

  const onSubmit = async (data: RegisterFormData) => {
    if (!termsAccepted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast.error('Please accept the Terms of Service and Privacy Policy.');
      // Flash the checkbox row in danger so the cause is visible next to
      // the control, then let it settle back (also cleared on toggle).
      setTermsError(true);
      if (termsErrorTimer.current) clearTimeout(termsErrorTimer.current);
      termsErrorTimer.current = setTimeout(() => setTermsError(false), 2500);
      scrollToField('terms');
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      // Save the picked default address as a real saved address —
      // fire-and-forget so a flaky create never blocks onboarding. Only
      // when the field still matches the geocoded pick (we have coords).
      if (
        selectedAddress &&
        data.default_address.trim() === selectedAddress.place_name
      ) {
        userService
          .addAddress({
            label: 'home',
            address: selectedAddress.place_name,
            lat: selectedAddress.center[1],
            lng: selectedAddress.center[0],
            is_default: true,
            created_at: new Date().toISOString(),
          } as any)
          .catch(() => {});
      }

      // Redeem an entered referral code — the backend register endpoint
      // doesn't accept one, so we apply it right after sign-up. Purely
      // fire-and-forget: a bad/duplicate code must never block onboarding,
      // and we only celebrate on a confirmed 201.
      const referralCode = data.referral_code?.trim();
      if (referralCode) {
        userService
          .applyReferral(referralCode)
          .then(() => {
            toast.success('Referral code applied — enjoy your reward!');
          })
          .catch(() => {});
      }

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
          // Don't silently skip verification — tell the user why they're
          // not seeing an OTP screen.
          toast.info(
            "We couldn't send a verification code — you can verify later from your profile.",
          );
          router.replace('/(auth)/role-select');
        }
      } else {
        router.replace('/(auth)/role-select');
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
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
        if (hasFieldError) {
          // Same treatment as client validation — bring the first
          // server-rejected field back on screen.
          const first = FIELD_ORDER.find((k) => serverErrors[k]);
          if (first) scrollToField(first);
        } else {
          toast.error(errorMessage(error, 'Couldn’t create your account. Please try again.'));
        }
      } else {
        let message: string;
        if (!status) {
          message = 'Unable to reach the server. Check your internet connection.';
        } else if (status === 429) {
          message = 'Too many attempts. Please wait a few minutes and try again.';
        } else if (status >= 500) {
          message = errorMessage(error, 'Couldn’t create your account. Please try again.');
        } else {
          message = errorMessage(error, 'Couldn’t create your account. Please try again.');
        }
        toast.error(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerStyle={{
            paddingBottom: 40,
            width: '100%',
            maxWidth: contentMaxWidth,
            alignSelf: 'center',
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Light airy hero — same flat background pattern as login. */}
          <View className="bg-background" style={rs.heroBlock}>
            <SafeAreaView edges={['top']}>
              <View className="px-6 pt-2 pb-9">
                <Pressable
                  className="w-10 h-10 rounded-full bg-surface border border-divider items-center justify-center"
                  onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/login')}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
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
                  className="text-[28px] font-montserrat-bold text-ink mt-2"
                  style={{ letterSpacing: -0.4, lineHeight: 32 }}
                  accessibilityRole="header"
                >
                  Create your account
                </Text>
                <Text className="text-[15px] font-montserrat mt-2 text-textSecondary">
                  Let’s set up your profile
                </Text>
              </View>
            </SafeAreaView>
          </View>

          {/* Form card lifts over the hero's curved bottom edge. */}
          <View
            className="flex-1 bg-surface px-6 pt-7"
            style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -22 }}
            onLayout={(e) => {
              cardY.current = e.nativeEvent.layout.y;
            }}
          >

          {/* Avatar Upload */}
          <Pressable
            className="self-center mb-6"
            onPress={handlePickAvatar}
            accessibilityRole="button"
            accessibilityLabel={image ? 'Change profile photo' : 'Add profile photo'}
          >
            <View className="self-center">
              <View className="w-24 h-24 rounded-full bg-primaryLight items-center justify-center overflow-hidden border-2 border-primary">
                {image ? (
                  <Image source={{ uri: image.uri }} className="w-full h-full" />
                ) : (
                  <Camera size={28} color={LightColors.primary} />
                )}
              </View>
              {/* Standard editable-avatar affordance once a photo exists. */}
              {image && (
                <View className="absolute right-0 bottom-0 w-6 h-6 rounded-full bg-primary items-center justify-center border-2 border-surface">
                  <Camera size={12} color={LightColors.textInverse} />
                </View>
              )}
            </View>
            <Text className="text-xs font-montserrat-semi text-primary text-center mt-1">
              {image ? 'Change Photo' : 'Add Photo'}
            </Text>
          </Pressable>

          {/* Form Fields — each validated field is wrapped in an onLayout
              View so a failed submit can scroll it back into view. */}
          <View
            onLayout={(e) => {
              fieldY.current.full_name = e.nativeEvent.layout.y;
            }}
          >
            <Controller
              control={control}
              name="full_name"
              rules={{
                required: 'Full name is required',
                maxLength: { value: 100, message: 'Maximum 100 characters' },
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Full Name"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="Juan Dela Cruz"
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => phoneRef.current?.focus()}
                  error={errors.full_name?.message}
                />
              )}
            />
          </View>

          <View
            onLayout={(e) => {
              fieldY.current.phone = e.nativeEvent.layout.y;
            }}
          >
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
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={phoneRef}
                  label="Phone Number"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="09XXXXXXXXX"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => emailRef.current?.focus()}
                  error={errors.phone?.message}
                />
              )}
            />
          </View>

          <View
            onLayout={(e) => {
              fieldY.current.email = e.nativeEvent.layout.y;
            }}
          >
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
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={emailRef}
                  label="Email"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  error={errors.email?.message}
                />
              )}
            />
          </View>

          <View
            onLayout={(e) => {
              fieldY.current.password = e.nativeEvent.layout.y;
            }}
          >
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
              render={({ field: { onChange, onBlur, value } }) => (
                <>
                  <Input
                    ref={passwordRef}
                    label="Password"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="Create a strong password"
                    secureTextEntry
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                    error={errors.password?.message}
                  />
                  <PasswordStrengthIndicator password={value} />
                </>
              )}
            />
          </View>

          <View
            onLayout={(e) => {
              fieldY.current.confirm_password = e.nativeEvent.layout.y;
            }}
          >
            <Controller
              control={control}
              name="confirm_password"
              rules={{
                required: 'Please confirm your password',
                validate: (value) =>
                  value === password || 'Passwords do not match',
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  ref={confirmPasswordRef}
                  label="Confirm Password"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="Confirm your password"
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => addressRef.current?.focus()}
                  error={errors.confirm_password?.message}
                />
              )}
            />
          </View>

          <Controller
            control={control}
            name="default_address"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                ref={addressRef}
                label="Default Address (Optional)"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="Search your address"
                autoComplete="street-address"
                textContentType="fullStreetAddress"
                returnKeyType="done"
                rightIcon={addressPinned ? MapPinCheck : undefined}
                rightIconColor={LightColors.successDark}
              />
            )}
          />
          {/* Persistent confirmation that the pick "took" — disappears the
              moment the user edits away from the geocoded value, honestly
              signalling the saved-address benefit is gone. */}
          {addressPinned && (
            <Text className="text-xs font-montserrat text-successDark -mt-3 mb-4 ml-1">
              Pinned — we’ll save this as your Home address
            </Text>
          )}

          {/* Autocomplete dropdown — same treatment as the saved-addresses
              search results. Selecting captures coordinates so we can
              create a real saved address after sign-up. */}
          {addressResults.length > 0 && (
            <View
              className="bg-surface rounded-xl overflow-hidden border border-divider -mt-2 mb-4"
              style={Elevation.md}
            >
              {addressResults.map((item, i) => (
                <Pressable
                  key={`${item.place_name}-${i}`}
                  className={`flex-row items-center px-3 py-3 ${i < addressResults.length - 1 ? 'border-b border-divider' : ''}`}
                  // py-3 alone leaves single-line rows ~40pt — pin the
                  // 44pt touch-target floor without changing 2-line rows.
                  style={{ minHeight: 44 }}
                  onPress={() => handleAddressSelect(item)}
                  accessibilityRole="button"
                  accessibilityLabel={item.place_name}
                >
                  <MapPin
                    size={14}
                    color={LightColors.textMuted}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    className="flex-1 text-[13px] font-montserrat text-textPrimary"
                    numberOfLines={2}
                  >
                    {item.place_name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Referral is a low-frequency path — keep it behind a one-tap
              disclosure so the form reads one field shorter for everyone
              else. Submit behavior is unchanged: the field defaults to ''
              and is only redeemed when non-empty. */}
          {showReferral ? (
            <Controller
              control={control}
              name="referral_code"
              rules={{
                maxLength: { value: 12, message: 'Maximum 12 characters' },
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Referral Code (Optional)"
                  value={value}
                  onChangeText={(t) => onChange(t.toUpperCase())}
                  onBlur={onBlur}
                  placeholder="Enter a friend's code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  autoFocus
                  returnKeyType="done"
                  error={errors.referral_code?.message}
                />
              )}
            />
          ) : (
            <Pressable
              className="self-start"
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setShowReferral(true);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Have a referral code?"
            >
              <Text className="text-[13px] font-montserrat-semi text-primary mb-4">
                Have a referral code?
              </Text>
            </Pressable>
          )}

          {/* Terms Checkbox */}
          <Pressable
            className="flex-row items-start mb-6"
            onLayout={(e) => {
              fieldY.current.terms = e.nativeEvent.layout.y;
            }}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setTermsError(false);
              setTermsAccepted(!termsAccepted);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="checkbox"
            accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            accessibilityState={{ checked: termsAccepted }}
          >
            <View
              className={`w-5 h-5 rounded border mr-3 mt-0.5 items-center justify-center ${
                termsAccepted
                  ? 'bg-primary border-primary'
                  : termsError
                    ? 'border-danger'
                    : 'border-dividerStrong'
              }`}
            >
              {termsAccepted && (
                <Check size={14} color={LightColors.textInverse} strokeWidth={3} />
              )}
            </View>
            <Text
              className={`flex-1 text-sm font-montserrat ${
                termsError ? 'text-dangerDark' : 'text-textSecondary'
              }`}
            >
              I agree to the{' '}
              <Text
                className="text-primary font-montserrat-semi"
                accessibilityRole="link"
                suppressHighlighting
                onPress={() => setLegalDoc('terms')}
              >
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text
                className="text-primary font-montserrat-semi"
                accessibilityRole="link"
                suppressHighlighting
                onPress={() => setLegalDoc('privacy')}
              >
                Privacy Policy
              </Text>
            </Text>
          </Pressable>

          {/* Not disabled on unchecked terms — a dead-looking button with
              no feedback is worse than letting onSubmit's guard explain
              (toast + haptic + checkbox flash + scroll). */}
          <Button
            title="Create Account"
            fullWidth
            size="lg"
            loading={loading}
            loadingTitle="Creating account…"
            onPress={handleSubmit(onSubmit, onInvalid)}
          />

          <View className="flex-row items-center justify-center mt-4 pt-2 pb-8">
            <Text className="text-[14px] font-montserrat text-textTertiary">
              Have an account?{' '}
            </Text>
            <Pressable
              onPress={() => router.push('/(auth)/login')}
              style={({ pressed }) => pressed && { opacity: 0.55 }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Log in"
            >
              <Text className="text-[14px] font-montserrat-semi text-primary">Log in</Text>
            </Pressable>
          </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <LegalModal
        visible={!!legalDoc}
        document={legalDoc ?? 'terms'}
        onClose={() => setLegalDoc(null)}
        onAgree={() => {
          setTermsAccepted(true);
          setTermsError(false);
          setLegalDoc(null);
        }}
      />
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
});
