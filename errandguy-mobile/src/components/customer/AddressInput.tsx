import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, FlatList, Pressable } from 'react-native';
import { MapPin, Navigation, Bookmark } from 'lucide-react-native';
import { useDebounce } from '../../hooks/useDebounce';

interface AddressSuggestion {
  place_name: string;
  center: [number, number]; // [lng, lat]
}

interface AddressInputProps {
  label: string;
  value: string;
  onSelect: (address: string, lat: number, lng: number) => void;
  onUseCurrentLocation?: () => void;
  onUseSavedAddress?: () => void;
  placeholder?: string;
  iconColor?: string;
}

export function AddressInput({
  label,
  value,
  onSelect,
  onUseCurrentLocation,
  onUseSavedAddress,
  placeholder = 'Enter address...',
  iconColor = '#2563EB',
}: AddressInputProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    // Mapbox Places API integration placeholder
    // In production, call Mapbox Geocoding API here
    setShowSuggestions(true);
    setSuggestions([]);
  }, [debouncedQuery]);

  const searchPlaces = useCallback((text: string) => {
    setQuery(text);
  }, []);

  const handleSelect = useCallback(
    (suggestion: AddressSuggestion) => {
      setQuery(suggestion.place_name);
      setShowSuggestions(false);
      setSuggestions([]);
      onSelect(
        suggestion.place_name,
        suggestion.center[1], // lat
        suggestion.center[0], // lng
      );
    },
    [onSelect],
  );

  return (
    <View className="mb-4">
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-1.5">
        {label}
      </Text>
      <View className="flex-row items-center border border-divider rounded-lg px-4 h-12 bg-surface">
        <MapPin size={18} color={iconColor} style={{ marginRight: 8 }} />
        <TextInput
          className="flex-1 text-base font-montserrat text-textPrimary"
          value={query}
          onChangeText={searchPlaces}
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
        />
      </View>

      {/* Quick Actions */}
      <View className="flex-row mt-2 gap-3">
        {onUseCurrentLocation && (
          <Pressable
            className="flex-row items-center"
            onPress={onUseCurrentLocation}
          >
            <Navigation size={14} color="#2563EB" />
            <Text className="text-xs font-montserrat text-primary ml-1">
              Current Location
            </Text>
          </Pressable>
        )}
        {onUseSavedAddress && (
          <Pressable
            className="flex-row items-center"
            onPress={onUseSavedAddress}
          >
            <Bookmark size={14} color="#2563EB" />
            <Text className="text-xs font-montserrat text-primary ml-1">
              Saved Address
            </Text>
          </Pressable>
        )}
      </View>

      {/* Suggestions Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <View className="bg-surface border border-divider rounded-lg mt-1 max-h-48 z-10">
          <FlatList
            data={suggestions}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <Pressable
                className="flex-row items-center px-4 py-3 border-b border-divider"
                onPress={() => handleSelect(item)}
              >
                <MapPin size={14} color="#94A3B8" />
                <Text
                  className="text-sm font-montserrat text-textPrimary ml-2 flex-1"
                  numberOfLines={2}
                >
                  {item.place_name}
                </Text>
              </Pressable>
            )}
          />
        </View>
      )}
    </View>
  );
}
