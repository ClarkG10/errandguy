import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  FileText,
  Camera,
  Car,
  CheckCircle,
  Clock,
  ChevronRight,
  Eye,
  LogOut,
} from 'lucide-react-native';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ImagePickerModal } from '../../components/ui/ImagePickerModal';
import { useAuthStore } from '../../stores/authStore';
import { useRunnerStore } from '../../stores/runnerStore';
import { useAuth } from '../../hooks/useAuth';
import * as Haptics from 'expo-haptics';
import { runnerService } from '../../services/runner.service';
import { userService } from '../../services/user.service';
import type { DocumentType, RunnerDocument } from '../../types';
import { toast } from '../../stores/toastStore';

const MASCOT = require('../../../assets/mascot.png');

interface DocConfig {
  type: DocumentType;
  label: string;
  description: string;
  icon: typeof FileText;
  required: boolean;
}

const REQUIRED_DOCUMENTS: DocConfig[] = [
  {
    type: 'government_id',
    label: 'Government ID',
    description: 'Valid government-issued ID (front side)',
    icon: FileText,
    required: true,
  },
  {
    type: 'selfie',
    label: 'Selfie with ID',
    description: 'Clear selfie while holding your ID',
    icon: Camera,
    required: true,
  },
];

const VEHICLE_DOCUMENTS: DocConfig[] = [
  {
    type: 'vehicle_registration',
    label: 'Vehicle Registration',
    description: "Your vehicle's OR/CR document",
    icon: Car,
    required: false,
  },
  {
    type: 'vehicle_photo',
    label: 'Vehicle Photo',
    description: 'Clear photo showing your vehicle and plate number',
    icon: Car,
    required: false,
  },
  {
    type: 'drivers_license',
    label: "Driver's License",
    description: 'Valid driver\'s license (front side)',
    icon: FileText,
    required: false,
  },
];

export default function RunnerOnboardingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { setRunnerProfile } = useRunnerStore();
  const { logout } = useAuth();
  const setRunnerOnboardingSkipped = useAuthStore(
    (s) => s.setRunnerOnboardingSkipped,
  );

  const [documents, setDocuments] = useState<RunnerDocument[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeDocType, setActiveDocType] = useState<DocumentType | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await runnerService.getRunnerProfile();
      const profile = res.data.data;
      setRunnerProfile(profile);
      setDocuments(profile?.documents ?? []);
    } catch {
      // Profile might not exist yet — that's ok
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [setRunnerProfile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const getDocByType = (type: DocumentType): RunnerDocument | undefined =>
    documents.find((d) => d.document_type === type);

  const handleUpload = (docType: DocumentType) => {
    setActiveDocType(docType);
    setPickerVisible(true);
  };

  const handleImageConfirm = async (uri: string) => {
    if (!activeDocType) return;
    setPickerVisible(false);
    await uploadFile(activeDocType, uri);
    setActiveDocType(null);
  };

  const uploadFile = async (docType: DocumentType, uri: string) => {
    setUploading(docType);
    try {
      const formData = new FormData();
      formData.append('document_type', docType);
      formData.append('file', {
        uri,
        name: `${docType}.jpg`,
        type: 'image/jpeg',
      } as any);

      await runnerService.uploadDocument(formData);
      await fetchProfile();
      toast.success('Document uploaded successfully');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to upload document');
    } finally {
      setUploading(null);
    }
  };

  const requiredUploaded = REQUIRED_DOCUMENTS.every(
    (doc) => getDocByType(doc.type) != null,
  );

  const handleContinue = async () => {
    if (!requiredUploaded) {
      toast.warning('Please upload your Government ID and Selfie with ID before continuing.');
      return;
    }

    // Refresh user profile to ensure runner_profile is synced
    try {
      const response = await userService.getProfile();
      setUser(response.data.data ?? response.data);
    } catch {}

    router.replace('/(runner)/(tabs)');
  };

  const renderDocCard = (doc: DocConfig) => {
    const existing = getDocByType(doc.type);
    const isUploading = uploading === doc.type;
    const Icon = doc.icon;

    let statusColor = '#94A3B8';
    let statusText = 'Not uploaded';
    let StatusIcon = ChevronRight;

    if (existing) {
      switch (existing.status) {
        case 'approved':
          statusColor = '#22C55E';
          statusText = 'Approved';
          StatusIcon = CheckCircle;
          break;
        case 'pending':
          statusColor = '#F59E0B';
          statusText = 'Under review';
          StatusIcon = Clock;
          break;
        case 'rejected':
          statusColor = '#EF4444';
          statusText = 'Rejected — tap to re-upload';
          StatusIcon = ChevronRight;
          break;
      }
    }

    const canUpload = !existing || existing.status === 'rejected';

    return (
      <Pressable
        key={doc.type}
        onPress={() => canUpload && handleUpload(doc.type)}
        disabled={isUploading || !canUpload}
      >
        <Card className="p-4 mb-3">
          <View className="flex-row items-center gap-3">
            {/* Thumbnail or icon */}
            {existing?.file_url ? (
              <Pressable
                onPress={() => {
                  setPreviewUri(existing.file_url!);
                  setPreviewVisible(true);
                }}
                className="w-12 h-12 rounded-xl overflow-hidden"
              >
                <Image
                  source={{ uri: existing.file_url }}
                  className="w-12 h-12"
                  resizeMode="cover"
                />
                <View className="absolute inset-0 bg-black/20 items-center justify-center">
                  <Eye size={14} color="#FFF" />
                </View>
              </Pressable>
            ) : (
              <View
                className="w-12 h-12 rounded-xl items-center justify-center"
                style={{ backgroundColor: statusColor + '15' }}
              >
                <Icon size={22} color={statusColor} />
              </View>
            )}
            <View className="flex-1">
              <View className="flex-row items-center gap-1">
                <Text className="text-sm font-montserrat-semi text-textPrimary">
                  {doc.label}
                </Text>
                {doc.required && (
                  <Text className="text-xs font-montserrat text-danger">*</Text>
                )}
              </View>
              <Text className="text-xs font-montserrat text-textTertiary mt-0.5">
                {existing ? statusText : doc.description}
              </Text>
            </View>
            {isUploading ? (
              <Text className="text-xs font-montserrat text-primary">
                Uploading…
              </Text>
            ) : canUpload ? (
              <StatusIcon size={16} color={statusColor} />
            ) : (
              <StatusIcon size={16} color={statusColor} />
            )}
          </View>
        </Card>
      </Pressable>
    );
  };

  // Find active doc config for modal title
  const activeDoc = [...REQUIRED_DOCUMENTS, ...VEHICLE_DOCUMENTS].find(
    (d) => d.type === activeDocType,
  );

  const handleLogout = useCallback(() => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  }, [logout, router]);

  const handleSkip = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await setRunnerOnboardingSkipped(true);
    router.replace('/(runner)/(tabs)');
  }, [setRunnerOnboardingSkipped, router]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Top bar with logout */}
      <View className="flex-row items-center justify-between px-5 pt-2">
        <Pressable
          onPress={handleSkip}
          className="px-3 py-2"
        >
          <Text className="text-sm font-montserrat text-textTertiary">
            Skip
          </Text>
        </Pressable>
        <Pressable
          onPress={handleLogout}
          className="w-9 h-9 rounded-full items-center justify-center"
        >
          <LogOut size={18} color="#94A3B8" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Header */}
        <View className="items-center px-6 pt-4 pb-6">
          <Image
            source={MASCOT}
            className="w-28 h-28 mb-3"
            resizeMode="contain"
          />
          <Text className="text-2xl font-montserrat-bold text-textPrimary text-center">
            Complete Your{'\n'}Runner Profile
          </Text>
          <Text className="text-sm font-montserrat text-textTertiary text-center mt-2 px-4">
            Upload your documents to get verified. You'll be able to start
            accepting errands once approved.
          </Text>
        </View>

        {/* Required Documents */}
        <View className="px-5 mb-6">
          <Text className="text-xs font-montserrat-bold text-textTertiary uppercase tracking-wider mb-3 ml-0.5">
            Required Documents
          </Text>
          {REQUIRED_DOCUMENTS.map(renderDocCard)}
        </View>

        {/* Vehicle Documents */}
        <View className="px-5 mb-6">
          <Text className="text-xs font-montserrat-bold text-textTertiary uppercase tracking-wider mb-3 ml-0.5">
            Vehicle Documents (Optional)
          </Text>
          <Text className="text-xs font-montserrat text-textTertiary mb-3 ml-0.5">
            Required if you'll use a motorcycle or car for errands.
          </Text>
          {VEHICLE_DOCUMENTS.map(renderDocCard)}
        </View>

        {/* Info Card */}
        <View className="px-5 mb-6">
          <Card className="p-4 bg-blue-50">
            <View className="flex-row items-start gap-3">
              <Clock size={18} color="#2563EB" />
              <View className="flex-1">
                <Text className="text-sm font-montserrat-semi text-primary">
                  Verification takes 1–2 business days
                </Text>
                <Text className="text-xs font-montserrat text-textSecondary mt-1">
                  You can still explore the app while we review your documents.
                  We'll notify you once you're approved.
                </Text>
              </View>
            </View>
          </Card>
        </View>

        {/* Continue Button */}
        <View className="px-5">
          <Button
            title={requiredUploaded ? 'Continue to Dashboard' : 'Upload Required Documents'}
            fullWidth
            size="lg"
            disabled={!requiredUploaded}
            onPress={handleContinue}
          />
          {!requiredUploaded && (
            <Pressable
              className="mt-3 py-3 items-center"
              onPress={handleSkip}
            >
              <Text className="text-sm font-montserrat text-textTertiary">
                Skip for now
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* Image picker modal */}
      <ImagePickerModal
        visible={pickerVisible}
        onClose={() => {
          setPickerVisible(false);
          setActiveDocType(null);
        }}
        onConfirm={handleImageConfirm}
        title={activeDoc ? `Upload ${activeDoc.label}` : 'Upload Photo'}
        subtitle={activeDoc?.description}
        uploading={!!uploading}
      />

      {/* Full-screen image preview */}
      {previewVisible && previewUri && (
        <Pressable
          className="absolute inset-0 bg-black/90 items-center justify-center z-50"
          onPress={() => setPreviewVisible(false)}
        >
          <Image
            source={{ uri: previewUri }}
            className="w-full h-96"
            resizeMode="contain"
          />
          <Text className="text-white font-montserrat text-sm mt-4">
            Tap anywhere to close
          </Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
