import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, CheckCircle, Clock, XCircle } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { Card } from '../../../components/ui/Card';
import { DocumentUploadCard } from '../../../components/runner/DocumentUploadCard';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { useRunnerStore } from '../../../stores/runnerStore';
import { runnerService } from '../../../services/runner.service';
import type { RunnerDocument, DocumentType } from '../../../types';
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
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  const [documents, setDocuments] = useState<RunnerDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeDocType, setActiveDocType] = useState<DocumentType | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await runnerService.getRunnerProfile();
      const profile = res.data.data;
      setRunnerProfile(profile);
      setDocuments(profile?.documents ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  }, [fetchProfile]);

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

  const getDocByType = (type: DocumentType): RunnerDocument | undefined => {
    return documents.find((d) => d.document_type === type);
  };

  const verificationStatus = runnerProfile?.verification_status;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(runner)/(tabs)')}
          className="w-9 h-9 rounded-xl bg-surface items-center justify-center"
          style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">
          Documents & Verification
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
              />
            );
          })}
        </View>
      </ScrollView>

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
