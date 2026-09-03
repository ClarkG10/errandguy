import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  FileText,
  Camera,
  Car,
  CheckCircle,
  Clock,
  ChevronRight,
  AlertCircle,
  Eye,
  LogOut,
  X,
} from 'lucide-react-native';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Illustration } from '../../components/ui/Illustration';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { ImagePickerModal } from '../../components/ui/ImagePickerModal';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/ErrorState';
import { BrandRefreshControl } from '../../components/ui/BrandRefreshControl';
import { Eyebrow } from '../../components/ui/Typography';
import { Spinner } from '../../components/ui/Spinner';
import { useAuthStore } from '../../stores/authStore';
import { useRunnerStore } from '../../stores/runnerStore';
import { useAuth } from '../../hooks/useAuth';
import * as Haptics from 'expo-haptics';
import { runnerService } from '../../services/runner.service';
import { userService } from '../../services/user.service';
import type { DocumentType, RunnerDocument } from '../../types';
import { toast } from '../../stores/toastStore';
import { errorMessage } from '../../utils/errorCatalog';
import { copy } from '../../constants/copy';
import { haptics } from '../../utils/haptics';
import { mediaSource } from '../../utils/mediaSource';
import { LightColors, Elevation } from '../../constants/colors';
import { useResponsive } from '../../constants/responsive';

const LOGO = require('../../../assets/logo-new.png');

interface DocConfig {
  type: DocumentType;
  label: string;
  description: string;
  icon: typeof FileText;
  required: boolean;
  /** One muted capture tip shown on each card — cuts rejected uploads. */
  tip: string;
}

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
    description: 'Valid driver\'s license (front side)',
    icon: FileText,
    required: false,
    tip: 'Clear photo, all corners visible, no glare',
  },
];

export default function RunnerOnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const { setRunnerProfile } = useRunnerStore();
  const { logout } = useAuth();

  const [documents, setDocuments] = useState<RunnerDocument[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [activeDocType, setActiveDocType] = useState<DocumentType | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await runnerService.getRunnerProfile();
      const profile = res.data.data;
      setRunnerProfile(profile);
      setDocuments(profile?.documents ?? []);
      setLoadError(false);
    } catch (err: any) {
      // A 404 means the profile simply doesn't exist yet — that's a
      // legitimate "nothing uploaded" state. Anything else (network
      // drop, 5xx) is a real failure: surface it instead of silently
      // rendering every document as "Not uploaded".
      if (err?.response?.status === 404) {
        setDocuments([]);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [setRunnerProfile]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
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

      const res = await runnerService.uploadDocument(formData);

      // Confirm on the UPLOAD, not after a second round trip. This is the
      // first screen of onboarding and the heaviest wait in it: the runner has
      // just watched a photo upload over mobile data, and making them wait on
      // a profile GET before anything acknowledges it is exactly where this
      // funnel loses people. The document IS submitted here, so it's honest.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success('Document uploaded — we’ll review it shortly.');

      // Tick the checklist from the response we already hold. The server
      // replaces any same-type document (a rejected one is deleted before the
      // insert), so replace rather than append.
      const uploaded = res.data?.data as RunnerDocument | undefined;
      if (uploaded) {
        setDocuments((prev) => [
          ...prev.filter((d) => d.document_type !== uploaded.document_type),
          uploaded,
        ]);
      }

      // Reconcile with the server in the background — it also carries
      // verification_status, which a resubmission flips back to pending.
      void fetchProfile();
    } catch (err: any) {
      haptics.error();
      toast.error(errorMessage(err, copy.runner.documentUploadFailed));
    } finally {
      setUploading(null);
    }
  };

  // A rejected doc still exists in the array but is NOT satisfied — the
  // runner must re-upload it. Gate and progress must reflect that, or the
  // bar reads 2/2 and Continue enables while a card says "Rejected".
  const isDocComplete = (type: DocumentType): boolean => {
    const d = getDocByType(type);
    return d != null && d.status !== 'rejected';
  };

  const requiredUploaded = REQUIRED_DOCUMENTS.every((doc) =>
    isDocComplete(doc.type),
  );
  const requiredCount = REQUIRED_DOCUMENTS.filter((doc) =>
    isDocComplete(doc.type),
  ).length;
  const optionalCount = VEHICLE_DOCUMENTS.filter((doc) =>
    isDocComplete(doc.type),
  ).length;

  const handleContinue = async () => {
    if (!requiredUploaded) {
      toast.warning('Please upload your Government ID and Selfie with ID before continuing.');
      return;
    }

    // Refresh user profile to ensure runner_profile is synced. noCache: the root
    // layout seeded a 30s micro-cache of /user/profile holding the OLD (rejected)
    // doc; without bypassing it, a just-re-uploaded doc still reads 'rejected'
    // and the KYC nav gate bounces the runner straight back to onboarding.
    try {
      const response = await userService.getProfile({ noCache: true });
      setUser(response.data.data ?? response.data);
    } catch {}

    router.replace('/(runner)/(tabs)');
  };

  const renderDocCard = (doc: DocConfig) => {
    const existing = getDocByType(doc.type);
    const isUploading = uploading === doc.type;
    const Icon = doc.icon;

    // Base tone drives the tile fill + glyph; the *Dark rung drives the
    // status TEXT so it clears AA 4.5:1 at 12px on the white card.
    let statusColor: string = LightColors.textMuted;
    let statusTextColor: string = LightColors.textTertiary;
    let statusText = 'Not uploaded';
    let StatusIcon = ChevronRight;

    if (existing) {
      switch (existing.status) {
        case 'approved':
          statusColor = LightColors.success;
          statusTextColor = LightColors.successDark;
          statusText = 'Approved';
          StatusIcon = CheckCircle;
          break;
        case 'pending':
          statusColor = LightColors.warning;
          statusTextColor = LightColors.warningDark;
          statusText = 'Under review';
          StatusIcon = Clock;
          break;
        case 'rejected':
          statusColor = LightColors.danger;
          statusTextColor = LightColors.dangerDark;
          statusText = 'Rejected — tap to re-upload';
          // Distinct alert glyph — a chevron would read as "not uploaded".
          StatusIcon = AlertCircle;
          break;
      }
    }

    const canUpload = !existing || existing.status === 'rejected';
    const interactive = canUpload && !isUploading;

    return (
      <Card
        key={doc.type}
        className="mb-3"
        onPress={interactive ? () => handleUpload(doc.type) : undefined}
        accessibilityLabel={`${doc.label}, ${doc.required ? 'required' : 'optional'}, ${existing ? statusText : 'not uploaded'}`}
        accessibilityHint={interactive ? 'Opens camera or gallery to upload' : undefined}
      >
        <View className="flex-row items-center gap-3">
            {/* Thumbnail or icon. Prefer download_url (the auth-gated route);
                file_url is null for new private-disk docs. */}
            {(existing?.download_url ?? existing?.file_url) ? (
              interactive ? (
                /* The whole Card re-uploads in this state (rejected) — keep the
                   thumbnail a plain image so a Pressable isn't nested inside the
                   pressable Card (nested a11y buttons + doubled press feedback). */
                <View className="w-12 h-12 rounded-xl overflow-hidden">
                  <Image
                    source={mediaSource(existing?.download_url ?? existing?.file_url)}
                    className="w-12 h-12"
                    resizeMode="cover"
                  />
                </View>
              ) : (
                /* Card is inert (approved / under review) — the thumbnail is the
                   only tap target and opens the full-screen preview. */
                <Pressable
                  onPress={() => {
                    setPreviewUri((existing.download_url ?? existing.file_url)!);
                    setPreviewVisible(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Preview uploaded ${doc.label}`}
                  className="w-12 h-12 rounded-xl overflow-hidden"
                >
                  <Image
                    source={mediaSource(existing?.download_url ?? existing?.file_url)}
                    className="w-12 h-12"
                    resizeMode="cover"
                  />
                  <View className="absolute inset-0 bg-black/30 items-center justify-center">
                    <Eye size={14} color={LightColors.textInverse} />
                  </View>
                </Pressable>
              )
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
                  <Text className="text-xs font-montserrat text-dangerDark">*</Text>
                )}
              </View>
              <Text
                className="text-xs font-montserrat-semi mt-0.5"
                style={{ color: existing ? statusTextColor : LightColors.textTertiary }}
              >
                {existing ? statusText : doc.description}
              </Text>
              {existing?.status === 'rejected' && existing.rejection_reason ? (
                /* Show WHY it was rejected so the runner can fix the defect
                   instead of re-submitting the same photo. */
                <View className="flex-row items-start gap-1 mt-1">
                  <AlertCircle
                    size={13}
                    color={LightColors.dangerDark}
                    style={{ marginTop: 1 }}
                  />
                  <Text
                    className="flex-1 text-xs font-montserrat"
                    style={{ color: LightColors.dangerDark }}
                  >
                    {existing.rejection_reason}
                  </Text>
                </View>
              ) : canUpload ? (
                <Text className="text-xs font-montserrat text-textTertiary mt-1">
                  {doc.tip}
                </Text>
              ) : null}
            </View>
            {isUploading ? (
              <View className="flex-row items-center gap-1.5">
                <Spinner size="small" color={LightColors.primary} />
                <Text className="text-xs font-montserrat text-primary">
                  Uploading…
                </Text>
              </View>
            ) : (
              <StatusIcon size={16} color={statusColor} />
            )}
          </View>
        </Card>
    );
  };

  // Find active doc config for modal title
  const activeDoc = [...REQUIRED_DOCUMENTS, ...VEHICLE_DOCUMENTS].find(
    (d) => d.type === activeDocType,
  );

  const handleLogout = useCallback(() => {
    setShowLogoutModal(true);
  }, []);

  const confirmLogout = useCallback(async () => {
    setShowLogoutModal(false);
    await logout();
    router.replace('/(auth)/welcome');
  }, [logout, router]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Top bar with logout. Document upload is mandatory — there is no
          skip; the only exits are Continue (enabled once required docs are
          uploaded) or Log out. */}
      <View className="flex-row items-center justify-end px-5 pt-2">
        <Pressable
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
          // 36pt visual — hitSlop lifts the effective target to 44pt.
          hitSlop={4}
          className="w-9 h-9 rounded-full items-center justify-center"
        >
          <LogOut size={18} color={LightColors.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          paddingBottom: 40,
        }}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View className="items-center px-6 pt-4 pb-6">
          <Illustration name="runner-verify" size={144} style={{ marginBottom: 8 }} />
          <Text className="text-2xl font-montserrat-bold text-textPrimary text-center">
            Complete Your Runner Profile
          </Text>
          <Text className="text-sm font-montserrat text-textTertiary text-center mt-2 px-4">
            Upload your documents to get verified. You'll be able to start
            accepting errands once approved.
          </Text>
        </View>

        {loading ? (
          /* First-load skeleton — mirrors the document card shape. */
          <View className="px-5 mb-6">
            <Skeleton width="45%" height={12} style={{ marginBottom: 14 }} />
            {[1, 2, 3, 4].map((i) => (
              <View
                key={i}
                className="bg-surface rounded-2xl p-4 mb-3"
                style={Elevation.sm}
              >
                <View className="flex-row items-center">
                  <Skeleton width={48} height={48} borderRadius={14} />
                  <View className="flex-1 ml-3">
                    <Skeleton width="45%" height={14} style={{ marginBottom: 6 }} />
                    <Skeleton width="70%" height={10} />
                  </View>
                  <Skeleton width={16} height={16} borderRadius={8} />
                </View>
              </View>
            ))}
          </View>
        ) : loadError ? (
          <ErrorState
            title="Couldn't load your documents"
            description="Check your internet connection and try again."
            onRetry={() => {
              setLoading(true);
              fetchProfile();
            }}
            style={{ flex: 0, paddingVertical: 32 }}
          />
        ) : (
          <>
            {/* Step progress — how far through the required uploads. */}
            <View className="px-5 mb-6">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-xs font-montserrat-semi text-textSecondary">
                  {requiredCount} of {REQUIRED_DOCUMENTS.length} required uploaded
                </Text>
                {optionalCount > 0 && (
                  <Text className="text-xs font-montserrat text-textTertiary">
                    +{optionalCount} optional
                  </Text>
                )}
              </View>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={`${requiredCount} of ${REQUIRED_DOCUMENTS.length} required documents uploaded`}
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: LightColors.divider,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${(requiredCount / REQUIRED_DOCUMENTS.length) * 100}%`,
                    height: '100%',
                    borderRadius: 3,
                    backgroundColor: LightColors.primary,
                  }}
                />
              </View>
            </View>

            {/* Required Documents */}
            <View className="px-5 mb-6">
              <Eyebrow className="mb-3 ml-0.5">Required Documents</Eyebrow>
              {REQUIRED_DOCUMENTS.map(renderDocCard)}
            </View>

            {/* Vehicle Documents */}
            <View className="px-5 mb-6">
              <Eyebrow className="mb-3 ml-0.5">Vehicle Documents (Optional)</Eyebrow>
              <Text className="text-xs font-montserrat text-textTertiary mb-3 ml-0.5">
                Required if you'll use a motorcycle or car for errands.
              </Text>
              {VEHICLE_DOCUMENTS.map(renderDocCard)}
            </View>

            {/* Info Card */}
            <View className="px-5 mb-6">
              <Card tone="tinted">
                <View className="flex-row items-start gap-3">
                  <Clock size={18} color={LightColors.primary} />
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
            </View>
          </>
        )}
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

      {/* Full-screen image preview — a real Modal so Android hardware-back
          closes the preview instead of popping out of onboarding. */}
      <Modal
        visible={previewVisible && !!previewUri}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <Pressable
          className="flex-1 bg-black/90 items-center justify-center"
          onPress={() => setPreviewVisible(false)}
          accessibilityRole="button"
          accessibilityLabel="Close preview"
        >
          {previewUri && (
            <Image
              source={mediaSource(previewUri)}
              className="w-full h-96"
              resizeMode="contain"
            />
          )}
          <Text className="text-white font-montserrat text-sm mt-4">
            Tap anywhere to close
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setPreviewVisible(false)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close preview"
          style={{ position: 'absolute', top: insets.top + 8, right: 20 }}
          className="w-10 h-10 rounded-full bg-black/50 items-center justify-center"
        >
          <X size={20} color={LightColors.textInverse} />
        </Pressable>
      </Modal>

      <ConfirmModal
        visible={showLogoutModal}
        title="Log out?"
        message="You'll need to sign in again to continue your runner application."
        confirmLabel="Log out"
        cancelLabel="Stay"
        destructive
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutModal(false)}
      />
    </SafeAreaView>
  );
}
