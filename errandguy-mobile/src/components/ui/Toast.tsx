import React, { useEffect, useCallback } from 'react';
import { Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react-native';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
}

const variantConfig: Record<
  ToastVariant,
  { bg: string; icon: typeof CheckCircle; color: string }
> = {
  success: { bg: 'bg-success', icon: CheckCircle, color: '#fff' },
  error: { bg: 'bg-danger', icon: AlertCircle, color: '#fff' },
  info: { bg: 'bg-primary', icon: Info, color: '#fff' },
  warning: { bg: 'bg-[#F59E0B]', icon: AlertTriangle, color: '#fff' },
};

export function Toast({
  message,
  variant = 'info',
  visible,
  onDismiss,
  duration = 3000,
}: ToastProps) {
  const translateY = useSharedValue(-100);
  const config = variantConfig[variant];
  const Icon = config.icon;

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, { duration: 300 });
      translateY.value = withDelay(
        duration,
        withTiming(-100, { duration: 300 }, () => {
          runOnJS(onDismiss)();
        }),
      );
    } else {
      translateY.value = withTiming(-100, { duration: 300 });
    }
  }, [visible, duration, onDismiss, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      className={`absolute top-12 left-4 right-4 ${config.bg} rounded-xl px-4 py-3 flex-row items-center z-50`}
      style={animatedStyle}
    >
      <Icon size={20} color={config.color} />
      <Text className="flex-1 text-white font-montserrat text-sm mx-3">
        {message}
      </Text>
      <Pressable onPress={onDismiss}>
        <X size={18} color={config.color} />
      </Pressable>
    </Animated.View>
  );
}
