import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Modal } from 'react-native';

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
}

function PulsingDot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 400, delay, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 400, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [delay, opacity]);

  return (
    <Animated.View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#2563EB',
        marginHorizontal: 4,
        opacity,
      }}
    />
  );
}

export function LoadingOverlay({ isVisible, message }: LoadingOverlayProps) {
  return (
    <Modal visible={isVisible} transparent statusBarTranslucent>
      <View className="flex-1 bg-black/40 items-center justify-center">
        <View className="bg-surface rounded-2xl px-8 py-6 items-center">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <PulsingDot delay={0} />
            <PulsingDot delay={150} />
            <PulsingDot delay={300} />
          </View>
          {message && (
            <Text className="text-sm font-montserrat text-textSecondary mt-3">
              {message}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}
