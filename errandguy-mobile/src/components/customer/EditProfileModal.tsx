import React, { useState } from 'react';
import { View, Text, Modal, Pressable, Alert, ScrollView } from 'react-native';
import { X } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { userService } from '../../services/user.service';
import { useImagePicker } from '../../hooks/useImagePicker';
import { Avatar } from '../ui/Avatar';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface EditProfileModalProps {
  visible: boolean;
  onClose: () => void;
}

export function EditProfileModal({ visible, onClose }: EditProfileModalProps) {
  const { user, updateProfile } = useAuthStore();
  const { pickImage } = useImagePicker();

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [saving, setSaving] = useState(false);

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
      Alert.alert(
        'Error',
        err?.response?.data?.message ?? 'Failed to update profile',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async () => {
    const result = await pickImage();
    if (!result) return;

    const formData = new FormData();
    formData.append('avatar', {
      uri: result.uri,
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
      Alert.alert('Error', 'Failed to upload avatar');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View className="flex-1 bg-background">
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-divider">
          <Text className="text-lg font-montserrat-bold text-textPrimary">
            Edit Profile
          </Text>
          <Pressable onPress={onClose}>
            <X size={24} color="#475569" />
          </Pressable>
        </View>

        <ScrollView className="flex-1 px-5 pt-6">
          <View className="items-center mb-6">
            <Pressable onPress={handleAvatarUpload}>
              <Avatar
                uri={user?.avatar_url}
                name={user?.full_name}
                size="xl"
              />
              <Text className="text-xs font-montserrat text-primary mt-2 text-center">
                Change Photo
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
      </View>
    </Modal>
  );
}
