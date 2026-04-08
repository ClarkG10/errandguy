import React from 'react';
import { Pressable, Text, Linking, Platform } from 'react-native';
import { Navigation } from 'lucide-react-native';

interface NavigateButtonProps {
  lat: number;
  lng: number;
  label?: string;
}

export function NavigateButton({ lat, lng, label }: NavigateButtonProps) {
  const handlePress = () => {
    const encodedLabel = encodeURIComponent(label ?? 'Destination');
    const url = Platform.select({
      ios: `maps:?daddr=${lat},${lng}&dirflg=d`,
      android: `google.navigation:q=${lat},${lng}`,
    });

    if (url) {
      Linking.openURL(url).catch(() => {
        // Fallback to Google Maps web
        Linking.openURL(
          `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
        );
      });
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      className="absolute bottom-4 right-4 bg-primary rounded-full px-4 py-3 flex-row items-center gap-2 shadow-md"
    >
      <Navigation size={18} color="#FFFFFF" />
      <Text className="text-sm font-montserrat-bold text-white">Navigate</Text>
    </Pressable>
  );
}
