import React, { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MapPin, Plus, X, Search } from 'lucide-react-native';
import { Input } from '../ui/Input';
import { LightColors } from '../../constants/colors';
import { geocodingService, type PlaceFeature } from '../../services/geocoding.service';
import type { DraftStop } from '../../types/booking';

interface StopsEditorProps {
  stops: DraftStop[];
  onChange: (stops: DraftStop[]) => void;
  /** Bias address search near the route (usually the dropoff). */
  proximity?: { lng: number; lat: number };
  /** Max EXTRA stops (server caps at 3). */
  max?: number;
  disabled?: boolean;
}

/**
 * Add / remove extra destinations for a multi-stop booking, entered by address
 * search (geocodingService) rather than a per-stop map pin — deliberately
 * self-contained and low-risk. Each selected place becomes a
 * {address, lat, lng} DraftStop appended after the primary dropoff. The parent
 * owns the stops array (persisted on the booking draft); this only edits it.
 */
export function StopsEditor({
  stops,
  onChange,
  proximity,
  max = 3,
  disabled = false,
}: StopsEditorProps) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceFeature[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bump on each keystroke so a slow, stale search response can't overwrite the
  // results of a newer query (last-write-wins by sequence).
  const searchSeq = useRef(0);

  const atMax = stops.length >= max;

  const runSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounce.current) clearTimeout(debounce.current);
      const trimmed = text.trim();
      if (trimmed.length < 3) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      const seq = ++searchSeq.current;
      debounce.current = setTimeout(() => {
        geocodingService
          .search(trimmed, undefined, undefined, proximity)
          .then((items) => {
            if (seq !== searchSeq.current) return; // a newer query superseded this
            setResults(items.slice(0, 5));
          })
          .catch(() => {
            if (seq === searchSeq.current) setResults([]);
          })
          .finally(() => {
            if (seq === searchSeq.current) setSearching(false);
          });
      }, 350);
    },
    [proximity],
  );

  const closeAdder = useCallback(() => {
    setAdding(false);
    setQuery('');
    setResults([]);
    setSearching(false);
    searchSeq.current++; // invalidate any in-flight search
  }, []);

  const addStop = useCallback(
    (place: PlaceFeature) => {
      Haptics.selectionAsync().catch(() => {});
      const [lng, lat] = place.center;
      onChange([...stops, { address: place.place_name, lat, lng }]);
      geocodingService.addRecent(place).catch(() => {});
      closeAdder();
    },
    [stops, onChange, closeAdder],
  );

  const removeStop = useCallback(
    (index: number) => {
      Haptics.selectionAsync().catch(() => {});
      onChange(stops.filter((_, i) => i !== index));
    },
    [stops, onChange],
  );

  return (
    <View>
      <Text className="text-sm font-montserrat-bold text-textPrimary mb-1">
        Extra stops
      </Text>
      <Text className="text-[11px] font-montserrat text-textSecondary mb-2">
        Add more drop-offs — each adds to the distance and a small per-stop fee.
      </Text>

      {/* Current stops */}
      {stops.map((stop, i) => (
        <View
          key={`${stop.lat},${stop.lng},${i}`}
          className="flex-row items-center bg-surfaceMuted rounded-xl px-3 py-2.5 mb-2"
        >
          <View
            className="w-6 h-6 rounded-full items-center justify-center mr-2.5"
            style={{ backgroundColor: LightColors.primaryLight }}
          >
            <Text className="text-[11px] font-inter-semi text-primary">{i + 1}</Text>
          </View>
          <Text
            className="flex-1 text-[13px] font-montserrat text-textPrimary"
            numberOfLines={2}
          >
            {stop.address}
          </Text>
          {!disabled && (
            <Pressable
              onPress={() => removeStop(i)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Remove stop ${i + 1}`}
              className="ml-2 w-7 h-7 items-center justify-center rounded-full"
              style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
            >
              <X size={16} color={LightColors.textSecondary} strokeWidth={2.2} />
            </Pressable>
          )}
        </View>
      ))}

      {/* Adder */}
      {adding ? (
        <View className="bg-surface rounded-xl border border-divider p-2.5 mb-1">
          <View className="flex-row items-center">
            <Search size={16} color={LightColors.textSecondary} strokeWidth={2} />
            <View className="flex-1 ml-2">
              <Input
                value={query}
                onChangeText={runSearch}
                placeholder="Search an address…"
                autoFocus
              />
            </View>
            <Pressable
              onPress={closeAdder}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Cancel adding a stop"
              className="ml-1.5 w-7 h-7 items-center justify-center"
              style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
            >
              <X size={18} color={LightColors.textSecondary} strokeWidth={2.2} />
            </Pressable>
          </View>

          {searching && (
            <View className="flex-row items-center px-1 py-2">
              <ActivityIndicator size="small" color={LightColors.primary} />
              <Text className="ml-2 text-[12px] font-montserrat text-textSecondary">
                Searching…
              </Text>
            </View>
          )}

          {!searching &&
            results.map((r, ri) => (
              <Pressable
                key={`${r.place_name}-${ri}`}
                onPress={() => addStop(r)}
                className="flex-row items-center px-1 py-2.5 border-t border-divider"
                style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${r.place_name}`}
              >
                <MapPin size={15} color={LightColors.primary} strokeWidth={2} />
                <Text
                  className="flex-1 ml-2 text-[13px] font-montserrat text-textPrimary"
                  numberOfLines={2}
                >
                  {r.place_name}
                </Text>
              </Pressable>
            ))}

          {!searching && query.trim().length >= 3 && results.length === 0 && (
            <Text className="px-1 py-2 text-[12px] font-montserrat text-textSecondary">
              No matches — try a nearby landmark.
            </Text>
          )}
        </View>
      ) : (
        !atMax &&
        !disabled && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setAdding(true);
            }}
            className="flex-row items-center justify-center rounded-xl border border-dashed border-primary py-2.5"
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
            accessibilityRole="button"
            accessibilityLabel="Add another stop"
          >
            <Plus size={16} color={LightColors.primary} strokeWidth={2.4} />
            <Text className="ml-1.5 text-[13px] font-montserrat-semi text-primary">
              Add another stop
            </Text>
          </Pressable>
        )
      )}

      {atMax && !adding && (
        <Text className="text-[11px] font-montserrat text-textMuted mt-1">
          You can add up to {max} extra stops.
        </Text>
      )}
    </View>
  );
}
