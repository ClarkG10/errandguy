import React, { useEffect } from 'react';
import { View, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

// ── Shimmer bar ───────────────────────────────────────────────
interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style,
}: SkeletonProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(progress.value, [0, 1], [-200, 200]),
      },
    ],
  }));

  return (
    <View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: '#E2E8F0',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View style={[{ flex: 1 }, animatedStyle]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.5)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ width: 200, height: '100%' }}
        />
      </Animated.View>
    </View>
  );
}

// ── Circle (avatars) ──────────────────────────────────────────
interface SkeletonCircleProps {
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function SkeletonCircle({ size = 48, style }: SkeletonCircleProps) {
  return <Skeleton width={size} height={size} borderRadius={size / 2} style={style} />;
}

// ── Prebuilt screen skeletons ─────────────────────────────────

/** Home screen skeleton — header, search, errand type cards, recent list */
export function HomeSkeleton() {
  return (
    <View className="flex-1 px-5 pt-4">
      {/* Header: avatar + greeting */}
      <View className="flex-row items-center mb-6">
        <SkeletonCircle size={44} />
        <View className="ml-3 flex-1">
          <Skeleton width="40%" height={12} style={{ marginBottom: 6 }} />
          <Skeleton width="55%" height={18} />
        </View>
        <SkeletonCircle size={32} />
      </View>

      {/* Search bar */}
      <Skeleton width="100%" height={44} borderRadius={12} style={{ marginBottom: 24 }} />

      {/* Section title */}
      <Skeleton width="35%" height={14} style={{ marginBottom: 12 }} />

      {/* Errand type cards — horizontal row */}
      <View className="flex-row gap-3 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <View key={i} className="items-center" style={{ width: 80 }}>
            <Skeleton width={64} height={64} borderRadius={16} style={{ marginBottom: 8 }} />
            <Skeleton width={56} height={10} />
          </View>
        ))}
      </View>

      {/* Section title */}
      <Skeleton width="40%" height={14} style={{ marginBottom: 12 }} />

      {/* Recent errand cards */}
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          className="bg-surface rounded-xl p-4 mb-3"
          style={{ borderWidth: 1, borderColor: '#F1F5F9' }}
        >
          <View className="flex-row items-center mb-3">
            <Skeleton width={36} height={36} borderRadius={10} />
            <View className="flex-1 ml-3">
              <Skeleton width="60%" height={14} style={{ marginBottom: 6 }} />
              <Skeleton width="40%" height={10} />
            </View>
            <Skeleton width={64} height={22} borderRadius={12} />
          </View>
          <Skeleton width="85%" height={10} style={{ marginBottom: 4 }} />
          <Skeleton width="70%" height={10} />
        </View>
      ))}
    </View>
  );
}

/** Activity / bookings list skeleton */
export function ActivitySkeleton() {
  return (
    <View className="flex-1 px-5 pt-4">
      {/* Title */}
      <Skeleton width="30%" height={22} style={{ marginBottom: 16 }} />

      {/* Filter chips */}
      <View className="flex-row gap-2 mb-5">
        {[60, 52, 72, 68].map((w, i) => (
          <Skeleton key={i} width={w} height={32} borderRadius={16} />
        ))}
      </View>

      {/* Booking cards */}
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          className="bg-surface rounded-xl p-4 mb-3"
          style={{ borderWidth: 1, borderColor: '#F1F5F9' }}
        >
          <View className="flex-row items-center mb-3">
            <Skeleton width={32} height={32} borderRadius={8} />
            <View className="flex-1 ml-3">
              <Skeleton width="50%" height={14} />
            </View>
            <Skeleton width={56} height={20} borderRadius={10} />
          </View>
          <Skeleton width="90%" height={10} style={{ marginBottom: 4 }} />
          <Skeleton width="80%" height={10} style={{ marginBottom: 8 }} />
          <View className="flex-row justify-between">
            <Skeleton width="35%" height={10} />
            <Skeleton width="20%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Tracking screen skeleton — map area + bottom panel */
export function TrackingSkeleton() {
  return (
    <View className="flex-1">
      {/* Map placeholder */}
      <Skeleton width="100%" height={300} borderRadius={0} />

      {/* Status pill */}
      <View className="px-5 pt-4">
        <Skeleton width="50%" height={28} borderRadius={14} style={{ marginBottom: 16 }} />

        {/* Runner info */}
        <View className="flex-row items-center mb-5">
          <SkeletonCircle size={44} />
          <View className="flex-1 ml-3">
            <Skeleton width="40%" height={14} style={{ marginBottom: 4 }} />
            <Skeleton width="30%" height={12} />
          </View>
          <View className="flex-row gap-2">
            <SkeletonCircle size={36} />
            <SkeletonCircle size={36} />
            <SkeletonCircle size={36} />
          </View>
        </View>

        {/* Timeline steps */}
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} className="flex-row items-center mb-4">
            <SkeletonCircle size={20} style={{ marginRight: 12 }} />
            <View className="flex-1">
              <Skeleton width="55%" height={12} style={{ marginBottom: 3 }} />
              <Skeleton width="25%" height={9} />
            </View>
          </View>
        ))}

        {/* Action button */}
        <Skeleton width="100%" height={48} borderRadius={12} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

/** Contact list skeleton */
export function ContactsSkeleton() {
  return (
    <View className="flex-1 px-5 pt-4">
      {/* Info banner */}
      <Skeleton width="100%" height={56} borderRadius={12} style={{ marginBottom: 16 }} />

      {/* Contact cards */}
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          className="bg-surface rounded-xl p-4 mb-3"
          style={{ borderWidth: 1, borderColor: '#F1F5F9' }}
        >
          <View className="flex-row items-center mb-2">
            <SkeletonCircle size={40} />
            <View className="flex-1 ml-3">
              <Skeleton width="50%" height={14} style={{ marginBottom: 4 }} />
              <Skeleton width="35%" height={10} />
            </View>
            <Skeleton width={56} height={22} borderRadius={12} />
          </View>
          <Skeleton width="45%" height={10} />
        </View>
      ))}
    </View>
  );
}

/** Runner home skeleton — toggle, stats, errands */
export function RunnerHomeSkeleton() {
  return (
    <View className="flex-1 px-5 pt-4">
      {/* Header */}
      <View className="flex-row items-center mb-6">
        <View className="flex-1">
          <Skeleton width="55%" height={22} />
        </View>
        <SkeletonCircle size={32} />
      </View>

      {/* Online toggle */}
      <Skeleton width="100%" height={56} borderRadius={16} style={{ marginBottom: 20 }} />

      {/* Section title */}
      <Skeleton width="35%" height={14} style={{ marginBottom: 12 }} />

      {/* Stats row */}
      <View className="flex-row gap-3 mb-6">
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            className="flex-1 bg-surface rounded-xl p-3 items-center"
            style={{ borderWidth: 1, borderColor: '#F1F5F9' }}
          >
            <SkeletonCircle size={28} style={{ marginBottom: 8 }} />
            <Skeleton width="50%" height={18} style={{ marginBottom: 4 }} />
            <Skeleton width="65%" height={10} />
          </View>
        ))}
      </View>

      {/* Section title */}
      <Skeleton width="40%" height={14} style={{ marginBottom: 12 }} />

      {/* Errand cards */}
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          className="bg-surface rounded-xl p-4 mb-3"
          style={{ borderWidth: 1, borderColor: '#F1F5F9' }}
        >
          <View className="flex-row justify-between mb-2">
            <Skeleton width="45%" height={14} />
            <Skeleton width="20%" height={14} />
          </View>
          <Skeleton width="80%" height={10} style={{ marginBottom: 4 }} />
          <Skeleton width="65%" height={10} />
        </View>
      ))}
    </View>
  );
}

/** Runner history skeleton */
export function HistorySkeleton() {
  return (
    <View className="flex-1 px-5 pt-4">
      {/* Title */}
      <Skeleton width="40%" height={22} style={{ marginBottom: 16 }} />

      {/* Search bar */}
      <Skeleton width="100%" height={44} borderRadius={12} style={{ marginBottom: 12 }} />

      {/* Filter pills */}
      <View className="flex-row gap-2 mb-5">
        {[48, 72, 68].map((w, i) => (
          <Skeleton key={i} width={w} height={32} borderRadius={16} />
        ))}
      </View>

      {/* History cards */}
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          className="bg-surface rounded-xl p-4 mb-3"
          style={{ borderWidth: 1, borderColor: '#F1F5F9' }}
        >
          <View className="flex-row justify-between mb-3">
            <Skeleton width="40%" height={14} />
            <Skeleton width={56} height={20} borderRadius={10} />
          </View>
          <View className="flex-row items-center mb-2">
            <SkeletonCircle size={10} style={{ marginRight: 8 }} />
            <Skeleton width="75%" height={10} />
          </View>
          <View className="flex-row items-center mb-2">
            <SkeletonCircle size={10} style={{ marginRight: 8 }} />
            <Skeleton width="70%" height={10} />
          </View>
          <View className="flex-row justify-between mt-1">
            <Skeleton width="30%" height={10} />
            <Skeleton width="18%" height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}
