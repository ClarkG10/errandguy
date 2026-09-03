import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CheckCircle, FileText, Camera, Car } from 'lucide-react-native';
import { LightColors, Elevation } from '../../../constants/colors';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Card } from '../../../components/ui/Card';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Eyebrow } from '../../../components/ui/Typography';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { DocumentUploadCard } from '../../../components/runner/DocumentUploadCard';
import { DocumentViewer } from '../../../components/runner/DocumentViewer';
import { VerificationBanner } from '../../../components/runner/VerificationBanner';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useAuthStore } from '../../../stores/authStore';
import { runnerService } from '../../../services/runner.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { useResponsive } from '../../../constants/responsive';
import type { RunnerDocument, DocumentType, RunnerProfile } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';

interface DocConfig {
  type: DocumentType;
  label: string;
  description: string;
  icon: typeof FileText;
  required: boolean;
  /** One muted capture tip per card — cuts rejected re-uploads. */
  tip: string;
}

// Grouped exactly like the Flow-7 onboarding screen so a runner re-viewing
// their docs sees the same Required-vs-Vehicle hierarchy and knows which
// documents actually gate verification.
const REQUIRED_DOCUMENTS: DocConfig[] = [
  {
    type: 'government_id',
    label: 'Government ID',
    description: 'Valid government-issued ID (front side)',
    icon: FileText,
    required: true,
    tip: 'Clear photo, all corners visible, no glare',
  },
  {
    type: 'selfie',
    label: 'Selfie with ID',
    description: 'Clear selfie while holding your ID',
    icon: Camera,
    required: true,
    tip: 'Face and ID both clearly visible, good lighting',
  },
];

const VEHICLE_DOCUMENTS: DocConfig[] = [
  {
    type: 'vehicle_registration',
    label: 'Vehicle Registration',
    description: "Your vehicle's OR/CR document",
    icon: Car,
    required: false,
    tip: 'All text readable, all corners visible, no glare',
  },
  {
    type: 'vehicle_photo',
    label: 'Vehicle Photo',
    description: 'Clear photo showing your vehicle and plate number',
    icon: Car,
    required: false,
    tip: 'Whole vehicle in frame with the plate readable',
  },
  {
    type: 'drivers_license',
    label: "Driver's License",
    description: "Valid driver's license (front side)",
    icon: FileText,
    required: false,
    tip: 'Clear photo, all corners visible, no glare',
  },
];

export default function DocumentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const { contentMaxWidth } = useResponsive();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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

  // Real data only: the fresh fetch, falling back to the store mirror
  // (hydrated by a previous successful fetch). When neither exists and
  // the fetch failed we show an ErrorState instead of faking a
  // "Pending Review" screen full of not-uploaded documents.
  const profile = profileQ.data ?? runnerProfile;
  const documents: RunnerDocument[] = profile?.documents ?? [];
  const verificationStatus = profile?.verification_status;
  const loadFailed = !!profileQ.error && !profile && !profileQ.loading;
  const initialLoading = profileQ.loading && !profile;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await profileQ.refresh();
    setRefreshing(false);
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
    setUploadPct(0);
    try {
      const formData = new FormData();
      formData.append('document_type', docType);
      formData.append('file', {
        uri,
        name: `${docType}.jpg`,
        type: 'image/jpeg',
      } as any);

      const res = await runnerService.uploadDocument(formData, (p) => setUploadPct(p));

      // Confirm the instant the UPLOAD lands, not after a second round trip.
      // The runner has just watched a photo crawl over mobile data; making them
      // then wait on a profile GET before anything acknowledges it is the
      // longest, worst-placed wait in the whole onboarding funnel — the one
      // with the heaviest drop-off (see errandguy:send-onboarding-reminders).
      // The document IS submitted at this point, so the copy is honest.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success('Document uploaded — we’ll review it shortly.');

      // Paint the new row from the response we already hold. The server
      // replaces any same-type document (it deletes a rejected one before
      // inserting), so mirror that rather than appending a duplicate.
      const uploaded = res.data?.data as RunnerDocument | undefined;
      if (uploaded) {
        profileQ.mutate((prev) =>
          prev
            ? {
                ...prev,
                documents: [
                  ...(prev.documents ?? []).filter(
                    (d) => d.document_type !== uploaded.document_type,
                  ),
                  uploaded,
                ],
              }
            : prev,
        );
      }

      // Server stays the authority — but in the background, where it costs
      // the runner nothing. It also carries verification_status, which the
      // upload can flip (rejected → pending on a resubmission).
      void profileQ.refresh();
    } catch (err: any) {
      const message = errorMessage(err, copy.runner.documentUploadFailed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast.error(message);
    } finally {
      setUploading(null);
      setUploadPct(null);
    }
  };

  const getDocByType = (type: DocumentType): RunnerDocument | undefined => {
    return documents.find((d) => d.document_type === type);
  };

  const renderDocCard = (doc: DocConfig) => {
    const existing = getDocByType(doc.type);
    return (
      <DocumentUploadCard
        key={doc.type}
        documentType={doc.type}
        label={doc.label}
        icon={doc.icon}
        description={doc.description}
        tip={doc.tip}
        required={doc.required}
        status={existing?.status}
        fileUrl={existing?.download_url ?? existing?.file_url}
        rejectionReason={existing?.rejection_reason}
        onUpload={() => handleUpload(doc.type)}
        onView={(uri) => setViewer({ uri, title: doc.label })}
        uploadProgress={uploading === doc.type ? uploadPct : null}
      />
    );
  };

  const activeDoc = [...REQUIRED_DOCUMENTS, ...VEHICLE_DOCUMENTS].find(
    (d) => d.type === activeDocType,
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Documents & Verification" showBack fallbackHref="/(runner)/(tabs)/profile" />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          // Root is a plain View (GradientHeader only insets the top), so the
          // scroll floor must clear the home indicator itself — flat 40 left
          // the last card grazing the gesture bar on inset devices.
          paddingBottom: insets.bottom + 32,
          flexGrow: loadFailed ? 1 : undefined,
        }}
      >
        {loadFailed ? (
          // The fetch failed and there is nothing cached — say so honestly
          // instead of rendering every document as "not uploaded" under a
          // fake "Pending Review" banner.
          <ErrorState
            title="Couldn't load your documents"
            onRetry={() => {
              void profileQ.refresh();
            }}
          />
        ) : initialLoading ? (
          // First-load skeleton — mirrors the document card shape (icon tile
          // + label + status + trailing glyph) so the first paint isn't a
          // blank white body.
          <View className="px-5 pt-4">
            <Skeleton width="45%" height={12} style={{ marginBottom: 14 }} />
            {[1, 2, 3, 4].map((i) => (
              <View
                key={i}
                className="bg-surface rounded-2xl p-4 mb-3"
                style={Elevation.sm}
              >
                <View className="flex-row items-center">
                  <Skeleton width={40} height={40} borderRadius={14} />
                  <View className="flex-1 ml-3">
                    <Skeleton width="45%" height={14} style={{ marginBottom: 6 }} />
                    <Skeleton width="70%" height={10} />
                  </View>
                  <Skeleton width={16} height={16} borderRadius={8} />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <>
            {/* Verification status banner — only from real data. */}
            {verificationStatus === 'approved' ? (
              <View className="px-5 pt-4 mb-4">
                <Card className="p-4 bg-successSoft">
                  <View className="flex-row items-center gap-3">
                    <CheckCircle size={24} color={LightColors.success} />
                    <View className="flex-1">
                      <Text className="text-sm font-montserrat-bold text-successDark">
                        Verified
                      </Text>
                      {profile?.approved_at && (
                        <Text className="text-xs font-montserrat text-textSecondary mt-0.5">
                          Approved on{' '}
                          {new Date(profile.approved_at).toLocaleDateString([], {
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
            ) : verificationStatus ? (
              // Reuse the app-wide banner so pending reads as amber warning
              // (not informational blue) and rejected/resubmit as danger —
              // one status, one color everywhere. No onAction: we're already
              // on the documents screen, so the "View documents" link is
              // redundant and is intentionally omitted.
              <View className="pt-4">
                <VerificationBanner status={verificationStatus} />
              </View>
            ) : null}

            {/* Required Documents */}
            <View className="px-5 mb-6">
              <Eyebrow className="mb-3 ml-0.5">Required Documents</Eyebrow>
              {REQUIRED_DOCUMENTS.map(renderDocCard)}
            </View>

            {/* Vehicle Documents */}
            <View className="px-5 mb-2">
              <Eyebrow className="mb-3 ml-0.5">Vehicle Documents (Optional)</Eyebrow>
              <Text className="text-xs font-montserrat text-textTertiary mb-3 ml-0.5">
                Required if you use a motorcycle or car for errands.
              </Text>
              {VEHICLE_DOCUMENTS.map(renderDocCard)}
            </View>
          </>
        )}
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
        title={activeDoc ? `Upload ${activeDoc.label}` : 'Upload Document'}
        subtitle={activeDoc?.description}
        uploading={!!uploading}
      />
    </View>
  );
}
