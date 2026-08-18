import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import {
  Upload,
  CheckCircle,
  AlertCircle,
  Clock,
  ChevronRight,
  FileText,
} from 'lucide-react-native';
import { Card } from '../ui/Card';
import { UploadProgress } from '../ui/UploadProgress';
import type { DocumentStatus } from '../../types';
import { LightColors } from '../../constants/colors';
import { mediaSource } from '../../utils/mediaSource';

interface DocumentUploadCardProps {
  documentType: string;
  label: string;
  status?: DocumentStatus | null;
  fileUrl?: string | null;
  rejectionReason?: string | null;
  onUpload: () => void;
  onView?: (uri: string) => void;
  /** 0–1 upload fraction while THIS document is uploading (null otherwise).
   *  Renders a determinate bar in place of the upload button. */
  uploadProgress?: number | null;
  /** Leading doc-type glyph (recognition + hierarchy). Falls back to a
   *  generic document icon so older call sites stay valid. */
  icon?: typeof FileText;
  /** One-line description shown before anything is uploaded. */
  description?: string;
  /** Muted capture tip — measurably cuts rejected re-uploads. */
  tip?: string;
  /** Marks the doc mandatory (renders the '*' marker + a11y wording). */
  required?: boolean;
}

// `glyph` is the brighter base tone — used ONLY for the icon tile fill and
// the trailing status glyph. `text` is the *Dark rung: the 12px status
// label and rejection reason must clear 4.5:1 AA on the white card, and the
// base tones don't. Wording mirrors the onboarding screen ('Under review').
const STATUS_CONFIG: Record<
  DocumentStatus,
  { icon: typeof CheckCircle; glyph: string; text: string; label: string }
> = {
  pending: {
    icon: Clock,
    glyph: LightColors.warning,
    text: LightColors.warningDark,
    label: 'Under review',
  },
  approved: {
    icon: CheckCircle,
    glyph: LightColors.success,
    text: LightColors.successDark,
    label: 'Approved',
  },
  rejected: {
    // Distinct alert glyph — a chevron/check would read as a settled state.
    icon: AlertCircle,
    glyph: LightColors.danger,
    text: LightColors.dangerDark,
    label: 'Rejected',
  },
};

export function DocumentUploadCard({
  documentType,
  label,
  status,
  fileUrl,
  rejectionReason,
  onUpload,
  onView,
  uploadProgress = null,
  icon,
  description,
  tip,
  required = false,
}: DocumentUploadCardProps) {
  const config = status ? STATUS_CONFIG[status] : null;
  const StatusIcon = config?.icon ?? ChevronRight;
  const glyphColor = config?.glyph ?? LightColors.textMuted;
  const isUploading = uploadProgress != null;
  const Icon = icon ?? FileText;
  const showRejection = status === 'rejected' && !!rejectionReason;

  return (
    <Card className="p-4 mb-3">
      {/* Header row: leading doc-type tile · label · status */}
      <View className="flex-row items-start gap-3">
        <View
          className="w-10 h-10 rounded-xl items-center justify-center"
          style={{ backgroundColor: glyphColor + '15' }}
        >
          <Icon size={20} color={glyphColor} />
        </View>

        <View className="flex-1">
          <View className="flex-row items-center gap-1">
            <Text className="text-sm font-montserrat-semi text-textPrimary">
              {label}
            </Text>
            {required && (
              <Text className="text-xs font-montserrat text-dangerDark">*</Text>
            )}
          </View>
          <Text
            className="text-xs font-montserrat-semi mt-0.5"
            style={{ color: config ? config.text : LightColors.textTertiary }}
          >
            {config ? config.label : description ?? 'Not uploaded'}
          </Text>
        </View>

        {!isUploading && <StatusIcon size={16} color={glyphColor} />}
      </View>

      {/* Rejection reason — AlertCircle + dangerDark so the runner can fix
          the defect instead of re-submitting the same photo. */}
      {showRejection && (
        <View className="flex-row items-start gap-1 mt-2">
          <AlertCircle
            size={13}
            color={LightColors.dangerDark}
            style={{ marginTop: 1 }}
          />
          <Text
            className="flex-1 text-xs font-montserrat"
            style={{ color: LightColors.dangerDark, lineHeight: 18 }}
          >
            {rejectionReason}
          </Text>
        </View>
      )}

      {/* Capture tip — only before an upload succeeds and when there's no
          rejection reason already occupying that slot. */}
      {tip && !showRejection && (!config || status === 'rejected') && (
        <Text className="text-xs font-montserrat text-textTertiary mt-2">
          {tip}
        </Text>
      )}

      {fileUrl && (
        <Pressable
          onPress={() => onView?.(fileUrl)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`View ${label}`}
          accessibilityHint="Opens a full-screen preview of the uploaded document"
          style={{ marginTop: 12 }}
        >
          {/* expo-image ignores Tailwind className for sizing, which is
              why the preview was invisible on the runner side. Set the
              dimensions inline. */}
          <Image
            source={mediaSource(fileUrl)}
            style={{
              width: '100%',
              height: 140,
              borderRadius: 16,
              backgroundColor: LightColors.surfaceMuted,
            }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
          <Text className="text-xs font-montserrat text-textTertiary mt-1.5">
            Tap to view full size
          </Text>
        </Pressable>
      )}

      {isUploading ? (
        // The picker sheet closes on confirm; the upload runs here in the
        // background, so this card is where the real % is visible.
        <View className="py-2 mt-2">
          <UploadProgress progress={uploadProgress} label="Uploading" />
        </View>
      ) : (
        <Pressable
          onPress={onUpload}
          accessibilityRole="button"
          accessibilityLabel={`${
            !fileUrl ? 'Upload' : status === 'rejected' ? 'Re-upload' : 'Replace'
          } ${label}`}
          // The dashed row is only ~32pt tall — hitSlop tops it up to the
          // 44pt effective touch-target minimum without changing the look.
          hitSlop={{ top: 8, bottom: 8 }}
          android_ripple={{ color: LightColors.primary + '22', borderless: false }}
          style={({ pressed }) => [pressed && { opacity: 0.85 }]}
          className="flex-row items-center justify-center gap-2 py-2 mt-3 rounded-lg border border-dashed border-primary bg-primaryLight active:bg-primary/10"
        >
          <Upload size={14} color={LightColors.primary} />
          <Text className="text-xs font-montserrat-bold text-primary">
            {!fileUrl ? 'Upload' : status === 'rejected' ? 'Re-upload' : 'Replace'}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}
