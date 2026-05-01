import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CheckCircle, Clock, XCircle } from 'lucide-react-native';
import { BackButton } from '../../../components/ui/BackButton';
import { Card } from '../../../components/ui/Card';
import { DocumentUploadCard } from '../../../components/runner/DocumentUploadCard';
import { DocumentViewer } from '../../../components/runner/DocumentViewer';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import type { RunnerDocument, DocumentType, RunnerProfile } from '../../../types';
import { toast } from '../../../stores/toastStore';

interface DocConfig {
  type: DocumentType;
  label: string;
}

const DOCUMENT_TYPES: DocConfig[] = [
  { type: 'government_id', label: 'Government ID' },
  { type: 'selfie', label: 'Selfie with ID' },
  { type: 'vehicle_registration', label: 'Vehicle Registration' },
  { type: 'vehicle_photo', label: 'Vehicle Photo' },
  { type: 'drivers_license', label: "Driver's License" },
];

export default function DocumentsScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  const [uploading, setUploading] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeDocType, setActiveDocType] = useState<DocumentType | null>(null);
  const [viewer, setViewer] = useState<{ uri: string; title: string } | null>(null);

  // Cache-first: re-opening this screen paints from AsyncStorage
  // immediately, then revalidates in the background. Previously every
  // visit fired /runner/profile and showed an empty state until it
  // returned.
  const profileQ = useQuery<RunnerProfile | null>(
    ['runner', 'profile', userId],
    async () => (await runnerService.getRunnerProfile()).data.data ?? null,
    { staleTime: 60_000, ttl: CacheTTL.LONG },
  );

  // Mirror to the global store so other screens (home, profile tab) stay
  // in sync without a second fetch.
  useEffect(() => {
    if (profileQ.data) setRunnerProfile(profileQ.data);
  }, [profileQ.data, setRunnerProfile]);

  const documents: RunnerDocument[] = profileQ.data?.documents ?? [];
  const verificationStatus = profileQ.data?.verification_status ?? runnerProfile?.verification_status;

  const onRefresh = useCallback(async () => {
    await profileQ.refresh();
  }, [profileQ]);

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
      await profileQ.refresh();
      toast.success('Document uploaded successfully');
    } catch (err: any) {
      const message =
        err?.message ?? err?.response?.data?.message ?? 'Failed to upload document';
      toast.error(message);
    } finally {
      setUploading(null);
    }
  };

  const getDocByType = (type: DocumentType): RunnerDocument | undefined => {
    return documents.find((d) => d.document_type === type);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <BackButton fallbackHref="/(runner)/(tabs)/profile" />
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Documents & Verification
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={profileQ.loading && !profileQ.data} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Verification Status Banner */}
        <View className="px-5 mb-4">
          <Card
            className={`p-4 ${
              verificationStatus === 'approved'
                ? 'bg-green-50'
                : verificationStatus === 'rejected'
                ? 'bg-red-50'
                : 'bg-blue-50'
            }`}
          >
            <View className="flex-row items-center gap-3">
              {verificationStatus === 'approved' ? (
                <CheckCircle size={24} color="#22C55E" />
              ) : verificationStatus === 'rejected' ? (
                <XCircle size={24} color="#EF4444" />
              ) : (
                <Clock size={24} color="#2563EB" />
              )}
              <View>
                <Text className="text-sm font-montserrat-bold text-textPrimary">
                  {verificationStatus === 'approved'
                    ? 'Verified'
                    : verificationStatus === 'rejected'
                    ? 'Rejected'
                    : 'Pending Review'}
                </Text>
                {runnerProfile?.approved_at && (
                  <Text className="text-xs font-montserrat text-textSecondary">
                    Approved on{' '}
                    {new Date(runnerProfile.approved_at).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </Text>
                )}
              </View>
            </View>
          </Card>
        </View>

        {/* Document Cards */}
        <View className="px-5">
          {DOCUMENT_TYPES.map((doc) => {
            const existing = getDocByType(doc.type);
            return (
              <DocumentUploadCard
                key={doc.type}
                documentType={doc.type}
                label={doc.label}
                status={existing?.status}
                fileUrl={existing?.file_url}
                rejectionReason={existing?.rejection_reason}
                onUpload={() => handleUpload(doc.type)}
                onView={(uri) => setViewer({ uri, title: doc.label })}
              />
            );
          })}
        </View>
      </ScrollView>

      <DocumentViewer
        visible={!!viewer}
        uri={viewer?.uri ?? null}
        title={viewer?.title}
        onClose={() => setViewer(null)}
      />

      <ImagePickerModal
        visible={pickerVisible}
        onClose={() => {
          setPickerVisible(false);
          setActiveDocType(null);
        }}
        onConfirm={handleImageConfirm}
        title={
          activeDocType
            ? `Upload ${DOCUMENT_TYPES.find((d) => d.type === activeDocType)?.label ?? 'Document'}`
            : 'Upload Document'
        }
        uploading={!!uploading}
      />
    </SafeAreaView>
  );
}
