import React, { useState, useCallback, useRef } from 'react';
import { View, Text, Modal, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, MapPin } from 'lucide-react-native';
import Mapbox from '@rnmapbox/maps';
import { Button } from '../ui/Button';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

// Default center: Manila, PH
const DEFAULT_CENTER: [number, number] = [121.0, 14.6];
const DEFAULT_ZOOM = 14;

interface MapPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (address: string, lat: number, lng: number) => void;
  initialCoordinate?: [number, number]; // [lng, lat]
  title?: string;
}

export function MapPickerModal({
  visible,
  onClose,
  onConfirm,
  initialCoordinate,
  title = 'Pick Location',
}: MapPickerModalProps) {
  const [selectedCoord, setSelectedCoord] = useState<[number, number] | null>(
    initialCoordinate ?? null,
  );
  const [address, setAddress] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const cameraRef = useRef<Mapbox.Camera>(null);

  const reverseGeocode = useCallback(async (lng: number, lat: number) => {
    if (!MAPBOX_TOKEN) return '';
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&language=en&limit=1`,
      );
      const data = await res.json();
      return data.features?.[0]?.place_name ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  }, []);

  const handleMapPress = useCallback(
    async (event: any) => {
      const coords = event.geometry?.coordinates as [number, number] | undefined;
      if (!coords) return;

      setSelectedCoord(coords);
      setLoading(true);
      const addr = await reverseGeocode(coords[0], coords[1]);
      setAddress(addr);
      setLoading(false);
    },
    [reverseGeocode],
  );

  const handleConfirm = useCallback(() => {
    if (!selectedCoord || !address) return;
    onConfirm(address, selectedCoord[1], selectedCoord[0]); // lat, lng
    onClose();
  }, [selectedCoord, address, onConfirm, onClose]);

  const center = selectedCoord ?? initialCoordinate ?? DEFAULT_CENTER;

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        {/* Header */}
        <View className="flex-row items-center px-5 py-3 border-b border-divider">
          <Pressable onPress={onClose} className="w-10 h-10 items-center justify-center">
            <X size={22} color="#0F172A" />
          </Pressable>
          <Text className="flex-1 text-lg font-montserrat-bold text-textPrimary text-center mr-10">
            {title}
          </Text>
        </View>

        {/* Map */}
        <View className="flex-1">
          <Mapbox.MapView
            style={{ flex: 1 }}
            styleURL={Mapbox.StyleURL.Street}
            logoEnabled={false}
            attributionEnabled={false}
            onPress={handleMapPress}
          >
            <Mapbox.Camera
              ref={cameraRef}
              centerCoordinate={center}
              zoomLevel={DEFAULT_ZOOM}
              animationDuration={500}
            />

            {/* Selected location marker */}
            {selectedCoord && (
              <Mapbox.PointAnnotation
                id="selected-location"
                coordinate={selectedCoord}
              >
                <View className="items-center">
                  <View className="w-10 h-10 rounded-full bg-primary items-center justify-center border-2 border-white shadow-lg">
                    <MapPin size={18} color="#FFFFFF" />
                  </View>
                  <View className="w-2 h-2 bg-primary rounded-full mt-0.5" />
                </View>
              </Mapbox.PointAnnotation>
            )}
          </Mapbox.MapView>

          {/* Hint overlay */}
          {!selectedCoord && (
            <View className="absolute top-4 left-5 right-5">
              <View className="bg-white/90 rounded-xl px-4 py-3 shadow-sm">
                <Text className="text-sm font-montserrat text-textSecondary text-center">
                  Tap on the map to select a location
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Bottom panel with selected address */}
        <View className="bg-surface border-t border-divider px-5 py-4 pb-8">
          {loading ? (
            <View className="flex-row items-center justify-center py-2 mb-3">
              <ActivityIndicator size="small" color="#2563EB" />
              <Text className="text-sm font-montserrat text-textSecondary ml-2">
                Getting address...
              </Text>
            </View>
          ) : address ? (
            <View className="mb-3">
              <Text className="text-xs font-montserrat text-textSecondary mb-1">
                Selected Location
              </Text>
              <Text className="text-sm font-montserrat-bold text-textPrimary" numberOfLines={2}>
                {address}
              </Text>
            </View>
          ) : null}
          <Button
            title="Confirm Location"
            onPress={handleConfirm}
            disabled={!selectedCoord || !address || loading}
            fullWidth
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
