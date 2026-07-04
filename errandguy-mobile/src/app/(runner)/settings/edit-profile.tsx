import React, { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { BottomActionBar } from '../../../components/ui/BottomActionBar';
import { Avatar } from '../../../components/ui/Avatar';
import { Card } from '../../../components/ui/Card';
import { useAuthStore } from '../../../stores/authStore';
import { userService } from '../../../services/user.service';
import { toast } from '../../../stores/toastStore';

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
      toast.error('Full name is required');
      return;
    }

    setLoading(true);
    try {
      const res = await userService.updateProfile({
        full_name: fullName.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      updateProfile(res.data.data);
      toast.success('Profile updated successfully');
      if (router.canGoBack()) router.back(); else router.replace('/(runner)/(tabs)/profile');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Edit Profile" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1 px-5"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Avatar identity header — grounds the form with who you're editing. */}
          <View className="items-center pt-5 pb-6">
            <Avatar uri={user?.avatar_url} name={user?.full_name} size="xl" />
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
          <Text className="text-[10px] font-montserrat-bold uppercase text-textSecondary mb-2 ml-1" style={{ letterSpacing: 1.4 }}>
            Personal details
          </Text>
          <Card padding="md">
            <Input
              label="Full Name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter your full name"
              autoCapitalize="words"
            />
            <Input
              label="Phone Number"
              value={phone}
              onChangeText={setPhone}
              placeholder="09XX XXX XXXX"
              keyboardType="phone-pad"
              maxLength={13}
            />
            <Input
              label="Email Address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky save bar — primary action lives in the thumb zone. */}
      <BottomActionBar>
        <Button
          title="Save Changes"
          onPress={handleSave}
          loading={loading}
          fullWidth
          size="lg"
        />
      </BottomActionBar>
    </View>
  );
}
