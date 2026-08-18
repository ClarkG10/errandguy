import React, { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { X } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { userService } from '../../services/user.service';
import { Avatar } from '../ui/Avatar';
import { ImagePickerModal } from '../ui/ImagePickerModal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { UploadProgress } from '../ui/UploadProgress';
import { toast } from '../../stores/toastStore';
import { runOptimistic } from '../../utils/optimistic';
import { errorMessage } from '../../utils/errorCatalog';
import { haptics } from '../../utils/haptics';
import { queueable } from '../../services/mutationQueue';
import { LightColors } from '../../constants/colors';
import { copy } from '../../constants/copy';

interface EditProfileModalProps {
  visible: boolean;
  onClose: () => void;
}

export function EditProfileModal({ visible, onClose }: EditProfileModalProps) {
  const { user, updateProfile } = useAuthStore();

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [nameError, setNameError] = useState<string | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPct, setAvatarPct] = useState<number | null>(null);

  // The modal stays mounted with a `visible` prop, so resync from the
  // user record on every open — closing means "discard", and edits made
  // elsewhere (e.g. the profile tab's focus-refresh) get picked up.
  // Deliberately keyed on `visible` alone: a mid-edit user update (the
  // avatar upload) must not wipe in-progress typing.
  useEffect(() => {
    if (visible) {
      setFullName(user?.full_name ?? '');
      setEmail(user?.email ?? '');
      setNameError(undefined);
      setEmailError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Save is a no-op when nothing changed — keep it disabled so a clean
  // close never routes through a pointless network call.
  const isDirty =
    fullName.trim() !== (user?.full_name ?? '') ||
    email.trim() !== (user?.email ?? '');

  const handleSave = async () => {
    let valid = true;
    if (!fullName.trim()) {
      setNameError('Please enter your name');
      valid = false;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError('Enter a valid email address');
      valid = false;
    }
    if (!valid) return;
    const nextName = fullName.trim();
    const nextEmail = email.trim();
    // Snapshot for rollback (this modal is layered over the profile tab and
    // does NOT re-fire the tab's focus-refresh on close, so there's no
    // server-read race to clobber the optimistic value).
    const prev = user;
    // Emptying the email field is a no-op on BOTH sides: the backend email rule
    // is not nullable, so an empty email is stripped from the PUT body and the
    // server keeps the old value. Omit it from the optimistic patch too (rather
    // than setting email:null) so the UI never shows a removal the server will
    // silently revert on the next focus-refresh. A single shared patch keeps
    // apply and commit consistent.
    const patch = { full_name: nextName, ...(nextEmail ? { email: nextEmail } : {}) };
    const q = queueable('user.updateProfile', patch, { dedupeKey: 'user-profile' });
    await runOptimistic({
      apply: () => {
        updateProfile(patch);
        onClose(); // instant — the profile reflects the change immediately
      },
      rollback: () => {
        if (prev) updateProfile({ full_name: prev.full_name, email: prev.email ?? null });
      },
      commit: q.commit,
      offline: q.offline,
      errorMessage: "Couldn't update your profile.",
      retry: true,
    });
  };

  const handleAvatarUpload = async (uri: string) => {
    setAvatarPickerVisible(false);
    setUploadingAvatar(true);
    setAvatarPct(0);

    const formData = new FormData();
    formData.append('avatar', {
      uri,
      type: 'image/jpeg',
      name: 'avatar.jpg',
    } as any);

    try {
      const res = await userService.uploadAvatar(formData, (p) => setAvatarPct(p));
      const avatarUrl = res.data.data?.avatar_url;
      if (avatarUrl) {
        updateProfile({ avatar_url: avatarUrl });
      }
    } catch (err) {
      haptics.error();
      toast.error(errorMessage(err, copy.profile.avatarUploadFailed));
    } finally {
      setUploadingAvatar(false);
      setAvatarPct(null);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Dim layer above the sheet so the parent screen reads as the
            "back" surface. rounded-t-3xl matches the app's sheet corner
            language (same as the delete sheet on the profile tab). */}
        <View className="flex-1 bg-black/40 justify-end">
          <View
            className="bg-background rounded-t-3xl overflow-hidden"
            style={{ height: '92%' }}
          >
            <View className="flex-row items-center justify-between px-5 py-5 border-b border-divider">
              <Text className="text-lg font-montserrat-semi text-textPrimary">
                Edit Profile
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  onClose();
                }}
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                accessibilityRole="button"
                accessibilityLabel="Close edit profile"
              >
                <X size={24} color={LightColors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              className="flex-1 px-5 pt-8"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 48 }}
            >
              <View className="items-center mb-6">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                    setAvatarPickerVisible(true);
                  }}
                  // Disabled mid-upload so the picker can't be double-launched.
                  disabled={uploadingAvatar}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  accessibilityRole="button"
                  accessibilityLabel="Change profile photo"
                  accessibilityState={{
                    busy: uploadingAvatar,
                    disabled: uploadingAvatar,
                  }}
                >
                  <Avatar
                    uri={user?.avatar_url}
                    name={user?.full_name}
                    size="xl"
                  />
                  {uploadingAvatar ? (
                    // The avatar picker closes on confirm and the upload runs
                    // in the background — so show real % HERE, where the edit
                    // sheet stays on screen, not in the (dismissed) picker.
                    <View style={{ width: 160, marginTop: 10 }}>
                      <UploadProgress progress={avatarPct} label="Uploading photo" />
                    </View>
                  ) : (
                    <Text className="text-xs font-montserrat text-primary mt-2 text-center">
                      Change Photo
                    </Text>
                  )}
                </Pressable>
              </View>

              <Input
                label="Full Name"
                value={fullName}
                onChangeText={(v) => {
                  setFullName(v);
                  setNameError(undefined);
                }}
                placeholder="Enter your name"
                error={nameError}
                autoComplete="name"
                textContentType="name"
              />
              <Input
                label="Email"
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setEmailError(undefined);
                }}
                placeholder="Enter your email"
                error={emailError}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
              />

              <View className="mt-4">
                <Button
                  title="Save Changes"
                  onPress={handleSave}
                  disabled={!isDirty}
                  fullWidth
                />
              </View>
            </ScrollView>

            <ImagePickerModal
              visible={avatarPickerVisible}
              onClose={() => setAvatarPickerVisible(false)}
              onConfirm={handleAvatarUpload}
              title="Profile Photo"
              subtitle="Choose a photo for your profile"
              uploading={uploadingAvatar}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
