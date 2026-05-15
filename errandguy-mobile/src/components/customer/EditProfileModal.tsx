import React, { useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { X } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { userService } from '../../services/user.service';
import { Avatar } from '../ui/Avatar';
import { ImagePickerModal } from '../ui/ImagePickerModal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { toast } from '../../stores/toastStore';

interface EditProfileModalProps {
  visible: boolean;
  onClose: () => void;
}

export function EditProfileModal({ visible, onClose }: EditProfileModalProps) {
  const { user, updateProfile } = useAuthStore();

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await userService.updateProfile({
        full_name: fullName.trim(),
        email: email.trim() || undefined,
      });
      updateProfile({
        full_name: fullName.trim(),
        email: email.trim() || null,
      });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (uri: string) => {
    setAvatarPickerVisible(false);
    setUploadingAvatar(true);

    const formData = new FormData();
    formData.append('avatar', {
      uri,
      type: 'image/jpeg',
      name: 'avatar.jpg',
    } as any);

    try {
      const res = await userService.uploadAvatar(formData);
      const avatarUrl = res.data.data?.avatar_url;
      if (avatarUrl) {
        updateProfile({ avatar_url: avatarUrl });
      }
    } catch {
      toast.error('Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
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
            "back" surface but the sheet itself is a flat panel — no
            native pageSheet curvature, no manual rounded-top. */}
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-background" style={{ height: '92%' }}>
            <View className="flex-row items-center justify-between px-7 py-5 border-b border-divider">
              <Text className="text-lg font-montserrat-semi text-textPrimary">
                Edit Profile
              </Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={24} color="#475569" />
              </Pressable>
            </View>

            <ScrollView
              className="flex-1 px-7 pt-8"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 48 }}
            >
              <View className="items-center mb-6">
                <Pressable onPress={() => setAvatarPickerVisible(true)}>
                  <Avatar
                    uri={user?.avatar_url}
                    name={user?.full_name}
                    size="xl"
                  />
                  <Text className="text-xs font-montserrat text-primary mt-2 text-center">
                    {uploadingAvatar ? 'Uploading…' : 'Change Photo'}
                  </Text>
                </Pressable>
              </View>

              <Input
                label="Full Name"
                value={fullName}
                onChangeText={setFullName}
                placeholder="Enter your name"
              />
              <Input
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                keyboardType="email-address"
              />

              <View className="mt-4">
                <Button
                  title="Save Changes"
                  onPress={handleSave}
                  loading={saving}
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
