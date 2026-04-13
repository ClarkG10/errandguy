import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, Alert, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, MapPin } from 'lucide-react-native';
import Mapbox from '@rnmapbox/maps';
import Slider from '@react-native-community/slider';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useLocationStore } from '../../../stores/locationStore';
import { runnerService } from '../../../services/runner.service';

export default function WorkingAreasScreen() {
  const router = useRouter();
  const { runnerProfile, setRunnerProfile } = useRunnerStore();
  const { currentLocation } = useLocationStore();

  const [radius, setRadius] = useState(runnerProfile?.working_area_radius ?? 5000);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const lat = runnerProfile?.working_area_lat ?? currentLocation?.lat ?? 0;
  const lng = runnerProfile?.working_area_lng ?? currentLocation?.lng ?? 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await runnerService.getRunnerProfile();
      setRunnerProfile(res.data.data);
      setRadius(res.data.data?.working_area_radius ?? 5000);
    } catch {}
    setRefreshing(false);
  }, []);

  const handleSave = async () => {
    if (!lat || !lng) {
      Alert.alert('Location Required', 'Please enable location services to set your working area.');
      return;
    }

    setSaving(true);
    try {
      await runnerService.updateRunnerProfile({
        working_area: JSON.stringify({
          lat,
          lng,
          radius,
        }),
      });
      Alert.alert('Success', 'Working area updated');
      const res = await runnerService.getRunnerProfile();
      setRunnerProfile(res.data.data);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const radiusKm = (radius / 1000).toFixed(1);

  // Generate circle polygon for the working area
  const circleGeoJSON = useMemo(() => {
    if (!lat || !lng) return null;
    const steps = 64;
    const km = radius / 1000;
    const coords: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * 2 * Math.PI;
      const dLat = (km / 111.32) * Math.cos(angle);
      const dLng = (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
      coords.push([lng + dLng, lat + dLat]);
    }
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [coords] },
    };
  }, [lat, lng, radius]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4">
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-lg font-montserrat-bold text-textPrimary">Working Areas</Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* Map with circle overlay */}
        <View className="mx-5 h-56 rounded-xl overflow-hidden mb-4">
          {lat && lng ? (
            <Mapbox.MapView
              style={{ flex: 1 }}
              styleURL={Mapbox.StyleURL.Street}
              logoEnabled={false}
              attributionEnabled={false}
              compassEnabled={false}
              scaleBarEnabled={false}
            >
              <Mapbox.Camera
                centerCoordinate={[lng, lat]}
                zoomLevel={Math.max(7, 14 - Math.log2(radius / 1000))}
                animationDuration={500}
              />

              {/* Center marker */}
              <Mapbox.PointAnnotation id="center" coordinate={[lng, lat]}>
                <View className="w-8 h-8 rounded-full bg-primary items-center justify-center border-2 border-white shadow-md">
                  <MapPin size={14} color="#FFFFFF" />
                </View>
              </Mapbox.PointAnnotation>

              {/* Radius circle */}
              {circleGeoJSON && (
                <Mapbox.ShapeSource id="radiusCircle" shape={circleGeoJSON}>
                  <Mapbox.FillLayer
                    id="radiusFill"
                    style={{
                      fillColor: '#2563EB',
                      fillOpacity: 0.12,
                    }}
                  />
                  <Mapbox.LineLayer
                    id="radiusOutline"
                    style={{
                      lineColor: '#2563EB',
                      lineWidth: 2,
                      lineDasharray: [2, 2],
                    }}
                  />
                </Mapbox.ShapeSource>
              )}
            </Mapbox.MapView>
          ) : (
            <View className="flex-1 bg-gray-100 items-center justify-center">
              <MapPin size={32} color="#94A3B8" />
              <Text className="text-sm font-montserrat text-textSecondary mt-2">
                Enable location to view map
              </Text>
            </View>
          )}
        </View>

        {/* Center Location */}
        <View className="px-5 mb-4">
          <Card className="p-4">
            <Text className="text-sm font-montserrat-bold text-textSecondary mb-1">
              Center Point
            </Text>
            <Text className="text-sm font-montserrat text-textPrimary">
              {lat && lng
                ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                : 'Location not available'}
            </Text>
            <Text className="text-xs font-montserrat text-textSecondary mt-1">
              Uses your current location or previously saved center.
            </Text>
          </Card>
        </View>

        {/* Radius Slider */}
        <View className="px-5 mb-4">
          <Card className="p-4">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-montserrat-bold text-textSecondary">
                Working Radius
              </Text>
              <Text className="text-sm font-montserrat-bold text-primary">
                {radiusKm} km
              </Text>
            </View>
            <Slider
              minimumValue={1000}
              maximumValue={50000}
              step={500}
              value={radius}
              onValueChange={setRadius}
              minimumTrackTintColor="#2563EB"
              maximumTrackTintColor="#E2E8F0"
              thumbTintColor="#2563EB"
            />
            <View className="flex-row justify-between mt-1">
              <Text className="text-[10px] font-montserrat text-textSecondary">1 km</Text>
              <Text className="text-[10px] font-montserrat text-textSecondary">50 km</Text>
            </View>
          </Card>
        </View>

        <View className="px-5">
          <Text className="text-xs font-montserrat text-textSecondary">
            You will receive errand requests within this radius of your center point.
            A larger radius gives you more requests but may require longer travel.
          </Text>
        </View>
      </ScrollView>

      {/* Save Button */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <Button title="Save Working Area" onPress={handleSave} loading={saving} fullWidth />
      </View>
    </SafeAreaView>
  );
}
