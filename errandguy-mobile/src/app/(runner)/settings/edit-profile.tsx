import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Input, type InputHandle } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { Eyebrow } from '../../../components/ui/Typography';
import { useResponsive } from '../../../constants/responsive';
import { useAuthStore } from '../../../stores/authStore';
import { userService } from '../../../services/user.service';
import { toast } from '../../../stores/toastStore';

export default function EditProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  // Snapshot the values the screen opened with so the Save CTA and the
  // discard guard can tell whether anything actually changed.
  const initial = useRef({
    name: user?.full_name ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
  });
  const dirty =
    fullName !== initial.current.name ||
    phone !== initial.current.phone ||
    email !== initial.current.email;

  // Once the user confirms leaving (or a save succeeds) the beforeRemove
  // guard must not re-intercept our own router.back().
  const leavingRef = useRef(false);

  // Chain the keyboard "next" key Name → Phone → Email.
  const phoneRef = useRef<InputHandle>(null);
  const emailRef = useRef<InputHandle>(null);

  const leaveScreen = useCallback(() => {
    leavingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(runner)/(tabs)/profile');
  }, [router]);

  const handleBackPress = useCallback(() => {
    if (dirty) setShowDiscardModal(true);
    else leaveScreen();
  }, [dirty, leaveScreen]);

  // Header back runs through handleBackPress, but Android hardware back
  // and the iOS swipe-back gesture pop the screen directly — intercept
  // those too so no path silently drops unsaved edits.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!dirty || leavingRef.current) return;
      e.preventDefault();
      setShowDiscardModal(true);
    });
    return unsub;
  }, [navigation, dirty]);

  const handleSave = async () => {
    // Inline validation — errors belong on the field, not in a toast that
    // disappears before the user finds the offending input.
    const trimmedName = fullName.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();

    let hasError = false;
    if (!trimmedName) {
      setNameError('Full name is required');
      hasError = true;
    } else {
      setNameError(undefined);
    }
    if (trimmedEmail && !/.+@.+\..+/.test(trimmedEmail)) {
      setEmailError('Enter a valid email address');
      hasError = true;
    } else {
      setEmailError(undefined);
    }
    // PH mobile numbers run 11 digits (09XXXXXXXXX); a cheap digit-count
    // floor catches obvious typos without rejecting landlines.
    if (trimmedPhone && trimmedPhone.replace(/\D/g, '').length < 7) {
      setPhoneError('Enter a valid phone number');
      hasError = true;
    } else {
      setPhoneError(undefined);
    }
    if (hasError) return;

    setLoading(true);
    try {
      const res = await userService.updateProfile({
        full_name: trimmedName,
        phone: trimmedPhone || undefined,
        email: trimmedEmail || undefined,
      });
      updateProfile(res.data.data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success('Profile updated successfully');
      leaveScreen();
    } catch (err: any) {
      toast.error(err?.message ?? err?.response?.data?.message ?? 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Edit Profile"
        showBack
        fallbackHref="/(runner)/(tabs)/profile"
        onBackPress={handleBackPress}
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 12) + 96,
            maxWidth: contentMaxWidth,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          {/* Identity anchor — a plain, non-editable header of who you're
              editing. Sized down from the large avatar so it doesn't read
              as a tap-to-change-photo control the screen doesn't offer. */}
          <View className="items-center pt-5 pb-6">
            <Avatar uri={user?.avatar_url} name={user?.full_name} size="lg" />
            <Text className="text-[16px] font-montserrat-bold text-textPrimary mt-3" numberOfLines={1}>
              {user?.full_name ?? 'Runner'}
            </Text>
            {user?.email ? (
              <Text className="text-[12px] font-montserrat text-textSecondary mt-0.5" numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>

          {/* Fields grouped in a single card, per the settings reference. */}
          <Eyebrow className="mb-2 ml-1">Personal details</Eyebrow>
          <Card padding="md">
            <Input
              label="Full Name *"
              value={fullName}
              onChangeText={(text) => {
                setFullName(text);
                if (nameError && text.trim()) setNameError(undefined);
              }}
              placeholder="Enter your full name"
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
              error={nameError}
            />
            <Input
              ref={phoneRef}
              label="Phone Number (optional)"
              value={phone}
              onChangeText={(text) => {
                setPhone(text);
                if (phoneError) setPhoneError(undefined);
              }}
              placeholder="09XX XXX XXXX"
              keyboardType="phone-pad"
              maxLength={13}
              textContentType="telephoneNumber"
              autoComplete="tel"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              error={phoneError}
            />
            <Input
              ref={emailRef}
              label="Email Address (optional)"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (emailError) setEmailError(undefined);
              }}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="done"
              onSubmitEditing={handleSave}
              error={emailError}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky save bar — primary action lives in the thumb zone. The
          inner column is clamped to the same content width as the form so
          the CTA doesn't stretch edge-to-edge on a tablet. */}
      <BottomActionBar>
        <View style={{ maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}>
          <Button
            title="Save Changes"
            onPress={handleSave}
            loading={loading}
            loadingTitle="Saving…"
            disabled={!dirty}
            fullWidth
            size="lg"
          />
        </View>
      </BottomActionBar>

      <ConfirmModal
        visible={showDiscardModal}
        title="Discard changes?"
        message="You'll lose the edits you've made to your profile."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setShowDiscardModal(false);
          leaveScreen();
        }}
        onCancel={() => setShowDiscardModal(false)}
      />
    </View>
  );
}
