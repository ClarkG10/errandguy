import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { MapPin, Navigation, Bookmark, Map } from 'lucide-react-native';
import { useDebounce } from '../../hooks/useDebounce';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

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
  onPickOnMap?: () => void;
  placeholder?: string;
  iconColor?: string;
}

export function AddressInput({
  label,
  value,
  onSelect,
  onUseCurrentLocation,
  onUseSavedAddress,
  onPickOnMap,
  placeholder = 'Enter address...',
  iconColor = '#2563EB',
}: AddressInputProps) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const debouncedQuery = useDebounce(query, 400);

  // Sync external value changes
  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (debouncedQuery.length < 3 || !MAPBOX_TOKEN) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const encoded = encodeURIComponent(debouncedQuery);
    // Bias results toward Philippines
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&country=ph&limit=5&language=en&types=address,poi,place,locality,neighborhood`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const results: AddressSuggestion[] = (data.features ?? []).map(
          (f: any) => ({
            place_name: f.place_name,
            center: f.center as [number, number],
          }),
        );
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
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
        {searching && <ActivityIndicator size="small" color="#94A3B8" />}
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
        {onPickOnMap && (
          <Pressable
            className="flex-row items-center"
            onPress={onPickOnMap}
          >
            <Map size={14} color="#2563EB" />
            <Text className="text-xs font-montserrat text-primary ml-1">
              Pick on Map
            </Text>
          </Pressable>
        )}
      </View>

      {/* Suggestions Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <ScrollView
          className="bg-surface border border-divider rounded-lg mt-1 max-h-48 z-10"
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {suggestions.map((item, index) => (
            <Pressable
              key={index}
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
          ))}
        </ScrollView>
      )}
    </View>
  );
}
