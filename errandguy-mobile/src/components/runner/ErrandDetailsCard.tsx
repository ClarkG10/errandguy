import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Linking } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { ChevronDown, ChevronUp, Check } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { resolveImageUrl } from '../../utils/resolveImageUrl';
import { storage } from '../../utils/storage';
import { parseChecklist } from '../../utils/shoppingChecklist';
import { runnerService } from '../../services/runner.service';
import { runOptimistic } from '../../utils/optimistic';
import { LightColors } from '../../constants/colors';
import { formatCurrency } from '../../utils/formatCurrency';

/**
 * A single structured shopping-list line as stored on the booking
 * (`booking.shopping_items`). This is the server-synced source of truth for
 * shopping errands; when present it supersedes the legacy description-parsed
 * checklist. `checked` is toggled by the runner via
 * `runnerService.updateChecklistTicks` and broadcast to the customer live.
 */
export interface ShoppingItem {
  id: string;
  name: string;
  qty: number;
  checked?: boolean;
  checked_at?: string | null;
}

interface ErrandDetailsCardProps {
  description?: string | null;
  specialInstructions?: string | null;
  itemPhotos?: string[] | null;
  estimatedItemValue?: number | null;
  /**
   * Structured shopping checklist from the booking (source of truth). When
   * present and non-empty, this renders as the tickable list and toggles sync
   * to the backend. When absent, the card falls back to parsing a checklist
   * out of `description` with device-local ticks.
   */
  shoppingItems?: ShoppingItem[] | null;
  /**
   * Used both to sync server-side ticks (`updateChecklistTicks`) and to
   * persist the device-local fallback ticks. When absent, the fallback ticks
   * still work in-memory but won't survive a remount.
   */
  bookingId?: string;
}

const ticksKey = (bookingId: string) => `@shopping_checklist_ticks_v1:${bookingId}`;

export function ErrandDetailsCard({
  description,
  specialInstructions,
  itemPhotos,
  estimatedItemValue,
  shoppingItems,
  bookingId,
}: ErrandDetailsCardProps) {
  // Default open when this is a shopping errand: the tickable list is the
  // runner's core reference, so it shouldn't sit behind an extra tap.
  const [expanded, setExpanded] = useState(
    () => Array.isArray(shoppingItems) && shoppingItems.length > 0,
  );

  // ── Server-synced shopping list (source of truth) ──
  // When the booking carries structured `shopping_items`, they win over the
  // legacy description-parsed checklist. Ticks sync to the backend.
  const hasServerItems = Array.isArray(shoppingItems) && shoppingItems.length > 0;

  // Optimistic local mirror of the server list so ticks feel instant. Kept in
  // sync with the incoming prop (a background refetch or realtime push wins).
  const [serverItems, setServerItems] = useState<ShoppingItem[]>(shoppingItems ?? []);
  const serverItemsKey = useMemo(
    () =>
      (shoppingItems ?? [])
        .map((it) => `${it.id}:${it.checked ? 1 : 0}`)
        .join('|'),
    [shoppingItems],
  );
  useEffect(() => {
    setServerItems(shoppingItems ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverItemsKey]);

  const toggleServerItem = (item: ShoppingItem) => {
    if (!bookingId) return;
    Haptics.selectionAsync().catch(() => {});
    const nextChecked = !item.checked;
    const previous = serverItems;
    // Optimistic flip via the shared helper — instant tick, rollback + one-tap
    // Retry on failure.
    void runOptimistic({
      apply: () =>
        setServerItems((cur) =>
          cur.map((it) =>
            it.id === item.id
              ? { ...it, checked: nextChecked, checked_at: nextChecked ? new Date().toISOString() : null }
              : it,
          ),
        ),
      rollback: () => setServerItems(previous),
      commit: () =>
        runnerService.updateChecklistTicks(bookingId, [{ id: item.id, checked: nextChecked }]),
      errorMessage: "Couldn't update the checklist. Please try again.",
      retry: true,
    });
  };

  const serverPickedCount = serverItems.filter((it) => it.checked).length;

  // A shopping checklist serialized into `description`, or null for a plain
  // free-text description (non-shopping errands render exactly as before).
  // Only used as the fallback when there are no structured server items.
  const checklist = useMemo(
    () => (hasServerItems ? null : parseChecklist(description)),
    [hasServerItems, description],
  );

  // Ticked item indices. Device-local only.
  const [ticked, setTicked] = useState<Record<number, boolean>>({});
  const [ticksLoaded, setTicksLoaded] = useState(false);

  // Hydrate ticks from storage once we know this is a checklist errand.
  useEffect(() => {
    if (!checklist || !bookingId) {
      setTicksLoaded(true);
      return;
    }
    let cancelled = false;
    storage
      .getJSON<number[]>(ticksKey(bookingId))
      .then((arr) => {
        if (cancelled) return;
        if (Array.isArray(arr)) {
          const map: Record<number, boolean> = {};
          for (const i of arr) map[i] = true;
          setTicked(map);
        }
        setTicksLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setTicksLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [checklist, bookingId]);

  const toggleTick = (index: number) => {
    Haptics.selectionAsync().catch(() => {});
    setTicked((prev) => {
      const next = { ...prev, [index]: !prev[index] };
      if (!next[index]) delete next[index];
      if (bookingId) {
        const indices = Object.keys(next).map((k) => Number(k));
        storage.setJSON(ticksKey(bookingId), indices).catch(() => {});
      }
      return next;
    });
  };

  const pickedCount = checklist
    ? checklist.items.filter((_, i) => ticked[i]).length
    : 0;

  const hasContent =
    hasServerItems ||
    description ||
    specialInstructions ||
    (itemPhotos && itemPhotos.length > 0);

  if (!hasContent) return null;

  return (
    <Card className="p-4 mb-3">
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between"
      >
        <Text className="text-sm font-montserrat-bold text-textPrimary">
          Errand Details
        </Text>
        {expanded ? (
          <ChevronUp size={18} color={LightColors.textTertiary} />
        ) : (
          <ChevronDown size={18} color={LightColors.textTertiary} />
        )}
      </Pressable>

      {expanded && (
        <View className="mt-3">
          {hasServerItems ? (
            /* ── Server-synced tickable shopping list (source of truth) ── */
            <View className="mb-2">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-xs font-montserrat-bold text-textSecondary">
                  Shopping list
                </Text>
                <Text className="text-xs font-montserrat-bold text-primary">
                  Picked {serverPickedCount}/{serverItems.length}
                </Text>
              </View>

              {serverItems.map((item) => {
                const checked = !!item.checked;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggleServerItem(item)}
                    disabled={!bookingId}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={`${item.name}, quantity ${item.qty}`}
                    hitSlop={6}
                    className="flex-row items-center py-2"
                  >
                    <View
                      className="items-center justify-center rounded-md mr-3"
                      style={{
                        width: 22,
                        height: 22,
                        borderWidth: checked ? 0 : 1.5,
                        borderColor: LightColors.dividerStrong,
                        backgroundColor: checked
                          ? LightColors.primary
                          : 'transparent',
                      }}
                    >
                      {checked && (
                        <Check size={14} color={LightColors.textInverse} strokeWidth={3} />
                      )}
                    </View>
                    <Text
                      className="flex-1 text-sm font-montserrat text-textPrimary"
                      style={
                        checked
                          ? {
                              textDecorationLine: 'line-through',
                              color: LightColors.textTertiary,
                            }
                          : undefined
                      }
                    >
                      {item.name}
                    </Text>
                    <Text className="text-sm font-montserrat-bold text-textSecondary ml-2">
                      ×{item.qty}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : checklist ? (
            /* ── Tickable shopping list ── */
            <View className="mb-2">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-xs font-montserrat-bold text-textSecondary">
                  Shopping list
                </Text>
                <Text className="text-xs font-montserrat-bold text-primary">
                  Picked {pickedCount}/{checklist.items.length}
                </Text>
              </View>

              {checklist.items.map((item, i) => {
                const checked = !!ticked[i];
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggleTick(i)}
                    disabled={!ticksLoaded}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={`${item.name}, quantity ${item.qty}`}
                    hitSlop={6}
                    className="flex-row items-center py-2"
                  >
                    <View
                      className="items-center justify-center rounded-md mr-3"
                      style={{
                        width: 22,
                        height: 22,
                        borderWidth: checked ? 0 : 1.5,
                        borderColor: LightColors.dividerStrong,
                        backgroundColor: checked
                          ? LightColors.primary
                          : 'transparent',
                      }}
                    >
                      {checked && (
                        <Check size={14} color={LightColors.textInverse} strokeWidth={3} />
                      )}
                    </View>
                    <Text
                      className="flex-1 text-sm font-montserrat text-textPrimary"
                      style={
                        checked
                          ? {
                              textDecorationLine: 'line-through',
                              color: LightColors.textTertiary,
                            }
                          : undefined
                      }
                    >
                      {item.name}
                    </Text>
                    <Text className="text-sm font-montserrat-bold text-textSecondary ml-2">
                      ×{item.qty}
                    </Text>
                  </Pressable>
                );
              })}

              {checklist.note && (
                <View className="mt-2">
                  <Text className="text-xs font-montserrat-bold text-textSecondary mb-1">
                    Note
                  </Text>
                  <Text className="text-sm font-montserrat text-textPrimary">
                    {checklist.note}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            description && (
              <View className="mb-2">
                <Text className="text-xs font-montserrat-bold text-textSecondary mb-1">
                  Description
                </Text>
                <Text className="text-sm font-montserrat text-textPrimary">
                  {description}
                </Text>
              </View>
            )
          )}

          {specialInstructions && (
            <View className="mb-2">
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-1">
                Special Instructions
              </Text>
              <Text className="text-sm font-montserrat text-textPrimary">
                {specialInstructions}
              </Text>
            </View>
          )}

          {estimatedItemValue != null && estimatedItemValue > 0 && (
            <View className="mb-2">
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-1">
                Estimated Item Value
              </Text>
              <Text
                className="text-sm font-inter-semi text-textPrimary"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatCurrency(estimatedItemValue)}
              </Text>
            </View>
          )}

          {itemPhotos && itemPhotos.length > 0 && (
            <View>
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
                Item Photos
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {itemPhotos.map((photo, i) => {
                  const uri = resolveImageUrl(photo);
                  if (!uri) return null;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => Linking.openURL(uri).catch(() => {})}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open item photo ${i + 1}`}
                      style={{ marginRight: 8 }}
                    >
                      <Image
                        source={{ uri }}
                        style={{ width: 96, height: 96, borderRadius: 16, backgroundColor: LightColors.surfaceMuted }}
                        contentFit="cover"
                        transition={150}
                        cachePolicy="memory-disk"
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
