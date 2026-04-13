import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBookingStore } from '../../../stores/bookingStore';
import { useLocation } from '../../../hooks/useLocation';
import { useImagePicker } from '../../../hooks/useImagePicker';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { AddressInput } from '../../../components/customer/AddressInput';
import { PhotoGrid } from '../../../components/customer/PhotoGrid';
import { MiniRouteMap } from '../../../components/customer/MiniRouteMap';
import { MapPickerModal } from '../../../components/customer/MapPickerModal';
import { SavedAddressSheet } from '../../../components/customer/SavedAddressSheet';
import { ERRAND_TYPES } from '../../../constants/errandTypes';
import type { SavedAddress } from '../../../types';

const STEP_LABELS = ['Type', 'Details', 'Schedule', 'Review'];

export default function TaskDetailsScreen() {
  const router = useRouter();
  const { draftBooking, updateDraft, setStep } = useBookingStore();
  const { getCurrentPosition } = useLocation();
  const { pickImage, takePhoto } = useImagePicker();

  const [showSavedSheet, setShowSavedSheet] = useState(false);
  const [mapPickerTarget, setMapPickerTarget] = useState<'pickup' | 'dropoff' | null>(null);
  const [photos, setPhotos] = useState<string[]>(
    draftBooking.item_photos ?? [],
  );

  // Determine if this is a transportation type
  const selectedErrand = ERRAND_TYPES.find(
    (t) => t.slug === 'transportation',
  );
  const isTransportation =
    draftBooking.errand_type_id != null &&
    selectedErrand != null;
  // We don't know the slug from the draft ID alone, so we'll use a flag approach
  // by checking if errand_type_id corresponds to a transportation slug.
  // For now, we rely on the description/special_instructions being optional for
  // transportation types.

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!draftBooking.pickup_address) {
      newErrors.pickup = 'Pickup location is required';
    }
    if (!draftBooking.dropoff_address) {
      newErrors.dropoff = 'Dropoff location is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [draftBooking]);

  const handleCurrentLocation = useCallback(
    async (type: 'pickup' | 'dropoff') => {
      const coords = await getCurrentPosition();
      if (!coords) {
        Alert.alert(
          'Location Permission',
          'Please enable location permissions to use this feature.',
        );
        return;
      }
      const address = `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;
      if (type === 'pickup') {
        updateDraft({
          pickup_address: address,
          pickup_lat: coords.lat,
          pickup_lng: coords.lng,
        });
      } else {
        updateDraft({
          dropoff_address: address,
          dropoff_lat: coords.lat,
          dropoff_lng: coords.lng,
        });
      }
    },
    [getCurrentPosition, updateDraft],
  );

  const handleSavedAddressSelect = useCallback(
    (address: SavedAddress) => {
      updateDraft({
        dropoff_address: address.address,
        dropoff_lat: address.lat,
        dropoff_lng: address.lng,
      });
    },
    [updateDraft],
  );

  const handleAddPhoto = useCallback(async () => {
    Alert.alert('Add Photo', 'Choose source', [
      {
        text: 'Camera',
        onPress: async () => {
          const result = await takePhoto();
          if (result) {
            const updated = [...photos, result.uri];
            setPhotos(updated);
            updateDraft({ item_photos: updated });
          }
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const result = await pickImage();
          if (result) {
            const updated = [...photos, result.uri];
            setPhotos(updated);
            updateDraft({ item_photos: updated });
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [photos, takePhoto, pickImage, updateDraft]);

  const handleRemovePhoto = useCallback(
    (index: number) => {
      const updated = photos.filter((_, i) => i !== index);
      setPhotos(updated);
      updateDraft({ item_photos: updated });
    },
    [photos, updateDraft],
  );

  const handleContinue = useCallback(() => {
    if (!validate()) return;
    setStep(2);
    router.push('/(customer)/book/schedule');
  }, [validate, setStep, router]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-4">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          Task Details
        </Text>
      </View>

      {/* Step Indicator */}
      <View className="flex-row px-5 mb-4">
        {STEP_LABELS.map((label, i) => (
          <View key={label} className="flex-1 items-center">
            <View
              className={`w-8 h-8 rounded-full items-center justify-center ${
                i <= 1 ? 'bg-primary' : 'bg-divider'
              }`}
            >
              <Text
                className={`text-xs font-montserrat-bold ${
                  i <= 1 ? 'text-white' : 'text-textSecondary'
                }`}
              >
                {i + 1}
              </Text>
            </View>
            <Text className="text-[10px] font-montserrat text-textSecondary mt-1">
              {label}
            </Text>
          </View>
        ))}
      </View>

      <ScrollView className="flex-1 px-5" showsVerticalScrollIndicator={false}>
        {/* Pickup Section */}
        <AddressInput
          label="Pickup Location"
          value={draftBooking.pickup_address ?? ''}
          onSelect={(addr, lat, lng) =>
            updateDraft({
              pickup_address: addr,
              pickup_lat: lat,
              pickup_lng: lng,
            })
          }
          onUseCurrentLocation={() => handleCurrentLocation('pickup')}
          onPickOnMap={() => setMapPickerTarget('pickup')}
          placeholder="Enter pickup address..."
          iconColor="#2563EB"
        />
        {errors.pickup && (
          <Text className="text-xs font-montserrat text-danger -mt-3 mb-3">
            {errors.pickup}
          </Text>
        )}

        <Input
          label="Contact Name (optional)"
          value={draftBooking.pickup_contact_name ?? ''}
          onChangeText={(v) => updateDraft({ pickup_contact_name: v })}
          placeholder="Person at pickup"
        />
        <Input
          label="Contact Phone (optional)"
          value={draftBooking.pickup_contact_phone ?? ''}
          onChangeText={(v) => updateDraft({ pickup_contact_phone: v })}
          placeholder="Phone number"
          keyboardType="phone-pad"
        />

        {/* Dropoff Section */}
        <View className="h-px bg-divider my-4" />
        <AddressInput
          label="Dropoff Location"
          value={draftBooking.dropoff_address ?? ''}
          onSelect={(addr, lat, lng) =>
            updateDraft({
              dropoff_address: addr,
              dropoff_lat: lat,
              dropoff_lng: lng,
            })
          }
          onUseCurrentLocation={() => handleCurrentLocation('dropoff')}
          onUseSavedAddress={() => setShowSavedSheet(true)}
          onPickOnMap={() => setMapPickerTarget('dropoff')}
          placeholder="Enter dropoff address..."
          iconColor="#EF4444"
        />
        {errors.dropoff && (
          <Text className="text-xs font-montserrat text-danger -mt-3 mb-3">
            {errors.dropoff}
          </Text>
        )}

        <Input
          label="Contact Name (optional)"
          value={draftBooking.dropoff_contact_name ?? ''}
          onChangeText={(v) => updateDraft({ dropoff_contact_name: v })}
          placeholder="Person at dropoff"
        />
        <Input
          label="Contact Phone (optional)"
          value={draftBooking.dropoff_contact_phone ?? ''}
          onChangeText={(v) => updateDraft({ dropoff_contact_phone: v })}
          placeholder="Phone number"
          keyboardType="phone-pad"
        />

        {/* Mini Map Preview */}
        <MiniRouteMap
          pickupLat={draftBooking.pickup_lat}
          pickupLng={draftBooking.pickup_lng}
          dropoffLat={draftBooking.dropoff_lat}
          dropoffLng={draftBooking.dropoff_lng}
          pickupAddress={draftBooking.pickup_address}
          dropoffAddress={draftBooking.dropoff_address}
        />

        {/* Task Description */}
        <View className="h-px bg-divider my-4" />
        <Input
          label="What do you need done?"
          value={draftBooking.description ?? ''}
          onChangeText={(v) => updateDraft({ description: v })}
          placeholder="Describe your errand..."
          multiline
          numberOfLines={4}
          maxLength={500}
        />
        <Input
          label="Special Instructions (optional)"
          value={draftBooking.special_instructions ?? ''}
          onChangeText={(v) => updateDraft({ special_instructions: v })}
          placeholder="Any special instructions..."
          multiline
          numberOfLines={2}
          maxLength={300}
        />

        {/* Item Photos */}
        <PhotoGrid
          photos={photos}
          maxPhotos={5}
          onAdd={handleAddPhoto}
          onRemove={handleRemovePhoto}
        />

        {/* Estimated Item Value */}
        <Input
          label="Estimated Item Value (optional)"
          value={
            draftBooking.estimated_item_value != null
              ? String(draftBooking.estimated_item_value)
              : ''
          }
          onChangeText={(v) => {
            const num = parseFloat(v);
            updateDraft({
              estimated_item_value: isNaN(num) ? undefined : num,
            });
          }}
          placeholder="₱0.00"
          keyboardType="numeric"
        />

        <View className="h-24" />
      </ScrollView>

      {/* Saved Address Sheet */}
      <SavedAddressSheet
        isVisible={showSavedSheet}
        onClose={() => setShowSavedSheet(false)}
        onSelect={handleSavedAddressSelect}
      />

      {/* Map Picker Modal */}
      <MapPickerModal
        visible={mapPickerTarget !== null}
        onClose={() => setMapPickerTarget(null)}
        title={mapPickerTarget === 'pickup' ? 'Pick Pickup Location' : 'Pick Dropoff Location'}
        initialCoordinate={
          mapPickerTarget === 'pickup' && draftBooking.pickup_lng && draftBooking.pickup_lat
            ? [draftBooking.pickup_lng, draftBooking.pickup_lat]
            : mapPickerTarget === 'dropoff' && draftBooking.dropoff_lng && draftBooking.dropoff_lat
              ? [draftBooking.dropoff_lng, draftBooking.dropoff_lat]
              : undefined
        }
        onConfirm={(addr, lat, lng) => {
          if (mapPickerTarget === 'pickup') {
            updateDraft({ pickup_address: addr, pickup_lat: lat, pickup_lng: lng });
          } else {
            updateDraft({ dropoff_address: addr, dropoff_lat: lat, dropoff_lng: lng });
          }
        }}
      />

      {/* Bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 bg-background border-t border-divider px-5 py-4 pb-8">
        <Button title="Continue" onPress={handleContinue} fullWidth />
      </View>
    </SafeAreaView>
  );
}
