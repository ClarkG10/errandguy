import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Upload, CheckCircle, XCircle, Clock } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { DocumentStatus } from '../../types';

interface DocumentUploadCardProps {
  documentType: string;
  label: string;
  status?: DocumentStatus | null;
  fileUrl?: string | null;
  rejectionReason?: string | null;
  onUpload: () => void;
  onView?: (uri: string) => void;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  pending: { icon: Clock, color: '#F59E0B', label: 'Pending' },
  approved: { icon: CheckCircle, color: '#22C55E', label: 'Approved' },
  rejected: { icon: XCircle, color: '#EF4444', label: 'Rejected' },
};

export function DocumentUploadCard({
  documentType,
  label,
  status,
  fileUrl,
  rejectionReason,
  onUpload,
  onView,
}: DocumentUploadCardProps) {
  const config = status ? STATUS_CONFIG[status] : null;
  const StatusIcon = config?.icon;

  return (
    <Card className="p-4 mb-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-sm font-montserrat-bold text-textPrimary">
          {label}
        </Text>
        {config && (
          <View className="flex-row items-center gap-1">
            {StatusIcon && <StatusIcon size={14} color={config.color} />}
            <Text
              className="text-xs font-montserrat-bold"
              style={{ color: config.color }}
            >
              {config.label}
            </Text>
          </View>
        )}
      </View>

      {fileUrl && (
        <Pressable
          onPress={() => onView?.(fileUrl)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`View ${label}`}
          accessibilityHint="Opens a full-screen preview of the uploaded document"
          style={{ marginBottom: 8 }}
        >
          {/* expo-image ignores Tailwind className for sizing, which is
              why the preview was invisible on the runner side. Set the
              dimensions inline. */}
          <Image
            source={{ uri: fileUrl }}
            style={{
              width: '100%',
              height: 140,
              borderRadius: 10,
              backgroundColor: '#F1F5F9',
            }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
          <Text className="text-[11px] font-montserrat text-textTertiary mt-1.5">
            Tap to view full size
          </Text>
        </Pressable>
      )}

      {rejectionReason && (
        <Text className="text-xs font-montserrat text-danger mb-2">
          Reason: {rejectionReason}
        </Text>
      )}

      <Pressable
        onPress={onUpload}
        className="flex-row items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-primary bg-primaryLight"
      >
        <Upload size={14} color="#2563EB" />
        <Text className="text-xs font-montserrat-bold text-primary">
          {!fileUrl ? 'Upload' : status === 'rejected' ? 'Re-upload' : 'Replace'}
        </Text>
      </Pressable>
    </Card>
  );
}
