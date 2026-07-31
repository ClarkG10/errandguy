import React from 'react';
import { Modal, View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { DownloadCloud } from 'lucide-react-native';
import { Button } from './Button';
import { useUpdateStore } from '../../stores/updateStore';
import { LightColors } from '../../constants/colors';

/**
 * Blocking gate for a CRITICAL OTA update. Mounted once globally in the root
 * layout; it stays invisible until useOtaUpdate marks an update mandatory,
 * then presents a non-dismissable sheet that only lets the user restart into
 * the downloaded update. Non-critical updates never trigger this.
 */
export function OtaUpdateGate() {
  const insets = useSafeAreaInsets();
  const status = useUpdateStore((s) => s.status);
  const isMandatory = useUpdateStore((s) => s.isMandatory);

  const visible = isMandatory && (status === 'downloading' || status === 'downloaded');
  const ready = status === 'downloaded';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => {}}>
      <View className="flex-1 bg-black/50 justify-end">
        <View
          className="bg-surface rounded-t-3xl px-6 pt-6"
          style={{ paddingBottom: insets.bottom + 24 }}
        >
          <View className="w-12 h-12 rounded-full bg-surfaceMuted items-center justify-center mb-4">
            <DownloadCloud size={24} color={LightColors.primary} strokeWidth={2} />
          </View>
          <Text className="text-[18px] font-montserrat-bold text-textPrimary mb-1">
            Update required
          </Text>
          <Text className="text-[14px] font-montserrat text-textSecondary mb-6">
            {ready
              ? 'A required update has been downloaded. Restart the app to continue.'
              : 'Downloading a required update. This will only take a moment…'}
          </Text>
          <Button
            title="Restart to update"
            loading={!ready}
            loadingTitle="Downloading…"
            disabled={!ready}
            onPress={() => {
              void Updates.reloadAsync();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}
