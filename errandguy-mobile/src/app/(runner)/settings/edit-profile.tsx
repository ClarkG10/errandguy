import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, User, Phone, Mail } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { useAuthStore } from '../../../stores/authStore';
import api from '../../../services/api';

export default function EditProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!fullName.trim()) {
      Alert.alert('Error', 'Full name is required');
      return;
    }

    setLoading(true);
    try {
      const res = await api.put('/user/profile', {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
      });
      updateProfile(res.data.data);
      Alert.alert('Success', 'Profile updated successfully');
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">Edit Profile</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1 px-5"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View className="mt-2">
            <Input
              label="Full Name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter your full name"
              leftIcon={User}
              autoCapitalize="words"
            />

            <Input
              label="Phone Number"
              value={phone}
              onChangeText={setPhone}
              placeholder="09XX XXX XXXX"
              leftIcon={Phone}
              keyboardType="phone-pad"
              maxLength={13}
            />

            <Input
              label="Email Address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              leftIcon={Mail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <Button
            title="Save Changes"
            onPress={handleSave}
            loading={loading}
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
