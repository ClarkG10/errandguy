import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  CheckCircle,
  AlertCircle,
  Info,
  AlertTriangle,
  Package,
} from 'lucide-react-native';
import { useToastStore, type ToastVariant } from '../../stores/toastStore';

const VARIANT_CONFIG: Record<
  ToastVariant,
  { bg: string; icon: typeof CheckCircle; iconColor: string; textColor: string }
> = {
  success: { bg: '#059669', icon: CheckCircle, iconColor: '#fff', textColor: '#fff' },
  error: { bg: '#EF4444', icon: AlertCircle, iconColor: '#fff', textColor: '#fff' },
  info: { bg: '#2563EB', icon: Package, iconColor: '#fff', textColor: '#fff' },
  warning: { bg: '#F59E0B', icon: AlertTriangle, iconColor: '#fff', textColor: '#fff' },
};

const SHOW_DURATION = 4000;

function ToastCard({
  id,
  message,
  variant,
}: {
  id: string;
  message: string;
  variant: ToastVariant;
}) {
  const { dismiss } = useToastStore();
  const translateY = useSharedValue(-80);
  const opacity = useSharedValue(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  const handleDismiss = useCallback(() => dismiss(id), [dismiss, id]);

  const animateOut = useCallback(() => {
    translateY.value = withTiming(-80, { duration: 350, easing: Easing.inOut(Easing.ease) });
    opacity.value = withTiming(0, { duration: 350, easing: Easing.inOut(Easing.ease) }, () => {
      runOnJS(handleDismiss)();
    });
  }, [translateY, opacity, handleDismiss]);

  useEffect(() => {
    // Animate in with spring for smooth entrance
    translateY.value = withSpring(0, { damping: 20, stiffness: 300, mass: 0.8 });
    opacity.value = withTiming(1, { duration: 300 });

    // Auto-dismiss timer
    timerRef.current = setTimeout(animateOut, SHOW_DURATION);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleManualDismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    animateOut();
  }, [animateOut]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.card, { backgroundColor: config.bg }, style]}>
      <Icon size={20} color={config.iconColor} />
      <Text style={[styles.message, { color: config.textColor }]} numberOfLines={3}>
        {message}
      </Text>
      <Pressable onPress={handleManualDismiss} hitSlop={12}>
        <X size={16} color={config.iconColor} />
      </Pressable>
    </Animated.View>
  );
}

export function ToastProvider() {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      style={[
        styles.container,
        { top: insets.top + (Platform.OS === 'android' ? 8 : 4) },
      ]}
      pointerEvents="box-none"
    >
      {toasts.slice(-3).map((t) => (
        <ToastCard key={t.id} {...t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 10,
    // shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    lineHeight: 18,
  },
});
