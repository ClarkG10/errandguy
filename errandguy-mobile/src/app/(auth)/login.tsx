import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import { ChevronLeft, Check } from 'lucide-react-native';
import { MotiView } from 'moti';
import { Input, type InputHandle } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { Wordmark } from '../../components/ui/Wordmark';
import { LogoutSplash } from '../../components/ui/LogoutSplash';
import { useAuth } from '../../hooks/useAuth';
import { useBiometricUnlock } from '../../hooks/useBiometricUnlock';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useResponsive } from '../../constants/responsive';
import { preloadCoreImages } from '../../services/preload.service';
import { userService } from '../../services/user.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { errorMessage } from '../../utils/errorCatalog';
import { LightColors } from '../../constants/colors';
import type { User } from '../../types';

interface LoginFormData {
  identifier: string;
  password: string;
}

const isPhone = (val: string) => /^(\+63|0)9\d{9}$/.test(val.trim());
const isEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());

/** 20pt checkbox square — fill/border/check animate in over 150ms (snap
 *  when OS reduce-motion is on). Shared by the two toggle rows below. */
function CheckboxSquare({ checked }: { checked: boolean }) {
  const reducedMotion = useReducedMotion();
  const duration = reducedMotion ? 0 : 150;
  return (
    <MotiView
      animate={{
        backgroundColor: checked ? LightColors.primary : LightColors.surface,
        borderColor: checked ? LightColors.primary : LightColors.dividerStrong,
      }}
      transition={{ type: 'timing', duration }}
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked && (
        <MotiView
          from={{ scale: reducedMotion ? 1 : 0.5, opacity: reducedMotion ? 1 : 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'timing', duration }}
        >
          <Check size={12} color={LightColors.textInverse} strokeWidth={3} />
        </MotiView>
      )}
    </MotiView>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const onboardingSeen = useAuthStore((s) => s.onboardingSeen);
  const rememberedCredentials = useAuthStore((s) => s.rememberedCredentials);
  const setRememberedCredentials = useAuthStore((s) => s.setRememberedCredentials);
  const setSessionPersistent = useAuthStore((s) => s.setSessionPersistent);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const biometricLockPending = useAuthStore((s) => s.biometricLockPending);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const completeBiometricUnlock = useAuthStore((s) => s.completeBiometricUnlock);
  const clearBiometricSession = useAuthStore((s) => s.clearBiometricSession);
  const {
    available: biometricAvailable,
    authenticate,
    biometricLabel,
    biometricIcon: BiometricIcon,
  } = useBiometricUnlock();
  const { contentMaxWidth } = useResponsive();
  const [loading, setLoading] = useState(false);
  // Success is a separate flag: the brand curtain must only rise once
  // the login is CONFIRMED — on failure the Button's own spinner is the
  // only feedback and the form stays put for the retry.
  const [succeeded, setSucceeded] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  // Checked by default — "Remember me" now keeps the session across full app
  // restarts (see setSessionPersistent), and staying signed in is the
  // expected default. Unchecking opts into a session-only login.
  const [rememberMe, setRememberMe] = useState(true);
  // Opt-in toggle shown alongside "Remember me" — enabling it persists
  // biometric unlock once the password login below succeeds.
  const [enableBiometric, setEnableBiometric] = useState(biometricEnabled);

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
    getValues,
  } = useForm<LoginFormData>({
    // Validate on blur (matches register.tsx) so format errors surface
    // before the user reaches the CTA.
    mode: 'onTouched',
    defaultValues: { identifier: '', password: '' },
  });
  const passwordRef = useRef<InputHandle>(null);

  useEffect(() => {
    if (rememberedCredentials?.identifier) {
      reset({ identifier: rememberedCredentials.identifier, password: '' });
    }
  }, [rememberedCredentials, reset]);

  useEffect(() => {
    preloadCoreImages().catch(() => {});
  }, []);

  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const id = data.identifier.trim();
      const loginData = isPhone(id)
        ? { phone: id, password: data.password }
        : { email: id, password: data.password };
      const userData = await login(loginData);
      // Confirmed — raise the brand curtain as the "you're in" handoff.
      setSucceeded(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // "Remember me" controls whether this session survives a full app
      // restart. Unchecked → session-only (signed out next cold start).
      await setSessionPersistent(rememberMe);
      if (rememberMe) {
        // Persist the identifier plus NON-SECRET display fields so the
        // next visit can greet the user by name with their avatar.
        await setRememberedCredentials({
          identifier: id,
          firstName: userData?.full_name?.split(' ')[0] || undefined,
          avatarUrl: userData?.avatar_url ?? null,
        });
      } else {
        await setRememberedCredentials(null);
      }
      // Opt into biometric unlock for next time. Requires a remembered
      // profile (we greet by name and replay the persisted token) so it
      // only takes effect when "Remember me" is on.
      await setBiometricEnabled(!!(enableBiometric && rememberMe && biometricAvailable));
    } catch (error: any) {
      const status = error?.status;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});

      // Map server-side 422 validation errors onto the matching fields
      // inline (mirrors register.tsx) instead of a generic toast.
      const serverErrors = error?.errors;
      if (status === 422 && serverErrors && typeof serverErrors === 'object') {
        let hasFieldError = false;
        for (const [field, messages] of Object.entries(serverErrors)) {
          const msg = Array.isArray(messages) ? String(messages[0]) : String(messages);
          if (field === 'phone' || field === 'email' || field === 'identifier') {
            setError('identifier', { message: msg });
            hasFieldError = true;
          } else if (field === 'password') {
            setError('password', { message: msg });
            hasFieldError = true;
          }
        }
        if (hasFieldError) return;
      }

      // 401 is the wrong-credentials case — anchor it under the field
      // being retyped (same inline pattern as the 422 mapping above)
      // instead of a toast that floats away from the form.
      if (status === 401) {
        setError('password', {
          message: 'Incorrect phone/email or password. Check and try again.',
        });
        return;
      }

      let message: string;
      if (!status) {
        message = 'Unable to reach the server. Check your internet connection.';
      } else if (status === 405) {
        message = 'Service temporarily unavailable. Please try again later.';
      } else if (status >= 500) {
        message = errorMessage(error, 'Couldn’t sign you in. Please try again.');
      } else if (status === 429) {
        message = 'Too many attempts. Please wait a few minutes and try again.';
      } else if (status === 422) {
        message =
          error.errors?.credentials?.[0] ||
          error.errors?.status?.[0] ||
          error.message ||
          'Invalid credentials. Please check and try again.';
      } else {
        message = error.message || 'Login failed. Please try again.';
      }
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  // Personalized "Welcome back" — only when a remembered profile with a
  // display name exists (identifier alone still pre-fills the form).
  const rememberedProfile =
    rememberedCredentials?.identifier && rememberedCredentials?.firstName
      ? rememberedCredentials
      : null;

  // Show the "Unlock with Face ID" affordance only when a session token
  // is being held pending an unlock (biometricLockPending) AND the device
  // can actually perform a biometric check. If the token was cleared
  // there's nothing to replay — the button hides and password login
  // applies (biometric cannot recover a password on its own).
  const canBiometricUnlock = biometricLockPending && biometricAvailable;

  const handleBiometricUnlock = useCallback(async () => {
    if (bioLoading) return;
    // Show the branded "Unlocking…" overlay for the WHOLE flow — while the
    // OS biometric sheet is up and while the session is re-validated — so
    // the user never sees the bare login form flash behind Face ID, and the
    // feedback is contextual instead of a tiny generic dot in the button.
    setBioLoading(true);
    const ok = await authenticate('Unlock ErrandGuy');
    if (!ok) {
      // Cancelled / failed scan — drop back to the form for a retry.
      setBioLoading(false);
      return;
    }
    try {
      // The persisted token is still in secureStorage, so this call is
      // authenticated. A 200 confirms the session is still valid.
      const res = await userService.getProfile();
      const fresh = (res.data?.data ?? res.data) as User;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Raise the brand curtain (same "you're in" handoff as the password
      // path), THEN restore the session so the router transitions under it.
      setSucceeded(true);
      await completeBiometricUnlock(fresh);
      // Leave bioLoading true — the curtain covers the frame until the root
      // layout routes into the app once isAuthenticated flips.
    } catch (err: any) {
      const status = err?.status;
      setBioLoading(false);
      // A definitive auth rejection means the token was revoked/expired —
      // drop it so the button hides and password login takes over.
      if (status === 401 || status === 403) {
        await clearBiometricSession();
        toast.info('Your session expired. Please sign in with your password.');
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        toast.error('Could not unlock. Please try again or use your password.');
      }
    }
  }, [authenticate, bioLoading, completeBiometricUnlock, clearBiometricSession]);

  // Auto-present the biometric prompt once on mount when the session is
  // locked — mirrors the native banking-app pattern. If the user cancels,
  // the on-screen button stays available for a retry.
  const autoPromptedRef = React.useRef(false);
  useEffect(() => {
    if (canBiometricUnlock && !autoPromptedRef.current) {
      autoPromptedRef.current = true;
      handleBiometricUnlock();
    }
  }, [canBiometricUnlock, handleBiometricUnlock]);

  const handleUseAnotherAccount = () => {
    Haptics.selectionAsync().catch(() => {});
    setRememberedCredentials(null).catch(() => {});
    // Also drop any pending biometric session + flag so the previous
    // user's token can't be replayed under a different account.
    clearBiometricSession().catch(() => {});
    setEnableBiometric(false);
    reset({ identifier: '', password: '' });
    setRememberMe(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-surface" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            // Clamp to a readable column on tablets / landscape.
            width: '100%',
            maxWidth: contentMaxWidth,
            alignSelf: 'center',
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back (only when arriving from onboarding) */}
          {!onboardingSeen && (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/welcome'))}
              hitSlop={10}
              className="w-10 h-10 rounded-full items-center justify-center bg-surface border border-divider mt-2"
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ChevronLeft size={22} color={LightColors.ink} strokeWidth={2.2} />
            </Pressable>
          )}

          {/* Brand + heading — simple, left-aligned, generous whitespace.
              When a remembered profile exists the heading becomes a
              personal greeting with the user's avatar. */}
          <View className="mt-8 mb-8">
            <Wordmark variant="stacked" height={84} style={{ alignSelf: 'center' }} />
            {rememberedProfile ? (
              <>
                {/* Returning-user card — groups the avatar, an eyebrow label
                    and the name into one aligned, tinted surface (the old
                    free-floating "Welcome back, {name}" wrapped awkwardly and
                    read as misaligned against the left-aligned form). */}
                <View className="flex-row items-center mt-6 rounded-2xl bg-surfaceMuted px-4 py-3.5">
                  <Avatar
                    uri={rememberedProfile.avatarUrl ?? undefined}
                    name={rememberedProfile.firstName}
                    size="lg"
                  />
                  <View className="flex-1 ml-3.5">
                    <Text
                      className="text-[12px] font-montserrat-semi text-textTertiary"
                      style={{ letterSpacing: 0.6 }}
                    >
                      WELCOME BACK
                    </Text>
                    <Text
                      className="text-[20px] font-montserrat-bold text-ink mt-0.5"
                      style={{ letterSpacing: -0.3 }}
                      numberOfLines={1}
                      accessibilityRole="header"
                    >
                      {rememberedProfile.firstName}
                    </Text>
                  </View>
                  <Pressable
                    onPress={handleUseAnotherAccount}
                    hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Not you? Use another account"
                    className="ml-2 px-3 py-2 rounded-full bg-surface border border-divider active:opacity-60"
                  >
                    <Text className="text-[12px] font-montserrat-semi text-primary">
                      Not you?
                    </Text>
                  </Pressable>
                </View>
                <Text className="text-[15px] font-montserrat text-textSecondary mt-4">
                  Sign in to continue your errand.
                </Text>
                {canBiometricUnlock && (
                  <View className="mt-4">
                    <Button
                      title={`Unlock with ${biometricLabel}`}
                      icon={BiometricIcon}
                      variant="secondary"
                      size="md"
                      fullWidth
                      loading={bioLoading}
                      loadingTitle="Unlocking…"
                      onPress={handleBiometricUnlock}
                      accessibilityHint="Use biometrics to resume your saved session"
                    />
                  </View>
                )}
              </>
            ) : (
              <>
                <Text
                  className="text-[28px] font-montserrat-bold text-ink mt-6"
                  style={{ letterSpacing: -0.4, lineHeight: 32 }}
                  accessibilityRole="header"
                >
                  Welcome back
                </Text>
                <Text className="text-[15px] font-montserrat text-textSecondary mt-2">
                  Sign in to continue your errand.
                </Text>
              </>
            )}
          </View>

          {/* Fields */}
          <Controller
            control={control}
            name="identifier"
            rules={{
              required: 'Phone or email is required',
              validate: (val) => isPhone(val) || isEmail(val) || 'Enter a valid phone or email',
            }}
            render={({ field: { onChange, onBlur, value } }) => {
              // Autofill/content hints can track the likely identifier type…
              const looksLikePhone = /^(\+63|09)\d/.test(value.trim());
              return (
                <Input
                  label="Phone or Email"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="09XXXXXXXXX or you@email.com"
                  // …but the KEYBOARD stays 'email-address' (static). A digit-
                  // leading email (e.g. 09171234567@gmail.com) previously flipped
                  // to phone-pad after 3 chars — which has no "@" key — hard-
                  // blocking that login; the per-keystroke switch also flickered
                  // the Android keyboard. email-address exposes digits via the
                  // 123 toggle so phone entry still works, and keeps "@"/letters
                  // reachable so any email is typable.
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete={looksLikePhone ? 'tel' : 'email'}
                  textContentType={looksLikePhone ? 'telephoneNumber' : 'emailAddress'}
                  // Jump straight into the form — unless a remembered
                  // identifier is pre-filled (password gets focus then).
                  autoFocus={!rememberedCredentials?.identifier}
                  returnKeyType="next"
                  blurOnSubmit={false}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  error={errors.identifier?.message}
                />
              );
            }}
          />

          <Controller
            control={control}
            name="password"
            rules={{
              required: 'Password is required',
              minLength: { value: 8, message: 'At least 8 characters' },
            }}
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                ref={passwordRef}
                label="Password"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="Enter your password"
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                // Don't fight the auto-presented biometric sheet — in the
                // locked state the keyboard would stack under Face ID.
                autoFocus={!!rememberedCredentials?.identifier && !canBiometricUnlock}
                returnKeyType="go"
                onSubmitEditing={handleSubmit(onSubmit)}
                error={errors.password?.message}
              />
            )}
          />

          {/* Remember + forgot */}
          <View className="flex-row items-center justify-between mt-1 mb-6">
            <Pressable
              className="flex-row items-center"
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                const next = !rememberMe;
                setRememberMe(next);
                // Biometric unlock replays the remembered profile, so it
                // can't survive forgetting the user.
                if (!next) setEnableBiometric(false);
              }}
              // Row is ~20pt tall — 12pt of vertical slop reaches the
              // 44pt minimum touch target.
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              accessibilityRole="checkbox"
              accessibilityLabel="Remember me"
              accessibilityState={{ checked: rememberMe }}
            >
              <CheckboxSquare checked={rememberMe} />
              <Text className="text-[13px] font-montserrat text-textTertiary ml-2">Remember me</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                // Hand a typed email over so forgot-password can pre-fill.
                const id = getValues('identifier').trim();
                if (isEmail(id)) {
                  router.push({ pathname: '/(auth)/forgot-password', params: { email: id } });
                } else {
                  router.push('/(auth)/forgot-password');
                }
              }}
              hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Forgot password?"
            >
              <Text className="text-[13px] font-montserrat-semi text-primary">Forgot password?</Text>
            </Pressable>
          </View>

          {/* Enable Face ID next time — only when the device supports it
              and we're not already in a locked-session state. Takes
              effect after this password login succeeds. */}
          {biometricAvailable && !biometricLockPending && (
            <Pressable
              className="flex-row items-center mb-6 -mt-2"
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                const next = !enableBiometric;
                setEnableBiometric(next);
                // Biometric unlock only takes effect with a remembered
                // profile — opting in turns Remember me on rather than
                // silently discarding the preference at submit time.
                if (next) setRememberMe(true);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              accessibilityRole="checkbox"
              accessibilityLabel={`Enable ${biometricLabel} unlock next time`}
              accessibilityState={{ checked: enableBiometric }}
            >
              <CheckboxSquare checked={enableBiometric} />
              <BiometricIcon size={15} color={LightColors.textTertiary} style={{ marginLeft: 8 }} />
              <View className="flex-1 ml-1.5">
                <Text className="text-[13px] font-montserrat text-textTertiary">
                  Unlock with {biometricLabel} next time
                </Text>
                <Text className="text-[12px] font-montserrat text-textMuted mt-0.5">
                  Keeps you remembered on this device
                </Text>
              </View>
            </Pressable>
          )}

          {/* Primary CTA */}
          <Button title="Log in" fullWidth size="lg" loading={loading} loadingTitle="Logging in…" onPress={handleSubmit(onSubmit)} />

          {/* Sign up */}
          <View className="flex-row items-center justify-center mt-auto pt-8 pb-2">
            <Text className="text-[14px] font-montserrat text-textTertiary">New here? </Text>
            <Pressable
              onPress={() => router.push('/(auth)/register')}
              style={({ pressed }) => pressed && { opacity: 0.55 }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Create account"
            >
              <Text className="text-[14px] font-montserrat-semi text-primary">Create account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {/* Branded "Unlocking…" overlay — shown for the whole biometric flow
          (OS sheet + session revalidation) so the login form never flashes
          behind Face ID. The success curtain (LogoutSplash) takes over the
          moment `succeeded` flips, so this hides then. */}
      {bioLoading && !succeeded && (
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
          className="bg-surface items-center justify-center"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Unlocking with ${biometricLabel}`}
        >
          <MotiView
            from={{ scale: 0.92, opacity: 0.7 }}
            animate={{ scale: 1.06, opacity: 1 }}
            transition={{ loop: true, repeatReverse: true, type: 'timing', duration: 900 }}
            className="w-20 h-20 rounded-full bg-primary50 items-center justify-center"
          >
            <BiometricIcon size={34} color={LightColors.primary} strokeWidth={2} />
          </MotiView>
          <Text className="text-[15px] font-montserrat-semi text-ink mt-5">Unlocking…</Text>
          <Text className="text-[13px] font-montserrat text-textTertiary mt-1">
            Verifying with {biometricLabel}
          </Text>
        </View>
      )}
      {/* Success curtain. The brand mark is now a full-colour badge, so it is
          shown untinted on a soft surface (matching the boot/logout splashes)
          instead of being flattened to a white silhouette on a blue field. */}
      <LogoutSplash
        visible={succeeded}
        backgroundColor={LightColors.background}
        logoSize={172}
      />
    </SafeAreaView>
  );
}
