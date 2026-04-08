import React from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { CheckCircle } from 'lucide-react-native';

type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  uri?: string | null;
  name?: string;
  size?: AvatarSize;
  showOnline?: boolean;
  isVerified?: boolean;
}

const sizeMap: Record<AvatarSize, { container: number; text: string; dot: number }> = {
  sm: { container: 32, text: 'text-xs', dot: 8 },
  md: { container: 40, text: 'text-sm', dot: 10 },
  lg: { container: 56, text: 'text-lg', dot: 12 },
  xl: { container: 80, text: 'text-2xl', dot: 16 },
};

function getInitials(name?: string): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function Avatar({
  uri,
  name,
  size = 'md',
  showOnline = false,
  isVerified = false,
}: AvatarProps) {
  const { container, text, dot } = sizeMap[size];

  return (
    <View style={{ width: container, height: container }}>
      {uri ? (
        <Image
          source={{ uri }}
          className="rounded-full"
          style={{ width: container, height: container }}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          placeholder={{ blurhash: 'LKN]Rv%2Tw=w]~RBVZRi};RPxuwH' }}
        />
      ) : (
        <View
          className="rounded-full bg-primaryLight items-center justify-center"
          style={{ width: container, height: container }}
        >
          <Text className={`${text} font-montserrat-bold text-primary`}>
            {getInitials(name)}
          </Text>
        </View>
      )}
      {showOnline && (
        <View
          className="absolute bottom-0 right-0 rounded-full bg-success border-2 border-surface"
          style={{ width: dot, height: dot }}
        />
      )}
      {isVerified && (
        <View className="absolute -bottom-0.5 -right-0.5">
          <CheckCircle size={dot + 2} color="#2563EB" fill="#DBEAFE" />
        </View>
      )}
    </View>
  );
}
