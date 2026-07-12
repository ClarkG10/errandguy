import React from 'react';
import { View, Pressable, Text, Modal } from 'react-native';
import { MotiView } from 'moti';
import { X } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';

interface FloatingModalProps {
  isVisible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export function FloatingModal({
  isVisible,
  onClose,
  children,
  title,
}: FloatingModalProps) {
  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
          backgroundColor: `${LightColors.ink}73`,
        }}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ width: '100%', maxWidth: 420 }}
        >
          <MotiView
            from={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 200 }}
            style={{
              backgroundColor: LightColors.surface,
              borderRadius: 20,
              padding: 26,
              width: '100%',
            }}
          >
            {title && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <Text style={{ fontSize: 17, fontFamily: 'Quicksand_700Bold', color: LightColors.textPrimary, flex: 1, marginRight: 12 }}>
                  {title}
                </Text>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: LightColors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X size={18} color={LightColors.textTertiary} />
                </Pressable>
              </View>
            )}
            {children}
          </MotiView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
