import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { ChevronDown, ChevronUp, Check } from 'lucide-react-native';
import { Card } from '../ui/Card';
import { resolveImageUrl } from '../../utils/resolveImageUrl';
import { mediaSource } from '../../utils/mediaSource';
import { ImageLightbox } from '../ui/ImageLightbox';
import { storage } from '../../utils/storage';
import { parseChecklist } from '../../utils/shoppingChecklist';
import { queueable } from '../../services/mutationQueue';
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
  // Full-size item-photo preview — opened in the bearer-aware in-app lightbox
  // (these are gated /internal/media URLs; the OS browser can't auth them).
  const [photoUri, setPhotoUri] = useState<string | null>(null);
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
    // Declared once so the online commit and an offline replay are the SAME
    // call. Ticks are the one thing a runner does inside a mall basement or a
    // grocery interior, so a dead signal must not un-tick their list: the tick
    // stays, the intent is persisted, and it replays on reconnect.
    //
    // dedupeKey is per ITEM: toggling one line three times offline coalesces to
    // its final state, and can never supersede a sibling item's queued tick.
    const q = queueable(
      'runner.updateChecklistTicks',
      { bookingId, items: [{ id: item.id, checked: nextChecked }] },
      {
        // Refetch the errand after the queued tick lands — and also when the
        // queue gives up on it (a 4xx because the errand closed), so the list
        // reconciles to server truth either way.
        invalidate: [['runner', 'errand', 'byId', bookingId]],
        dedupeKey: `checklist-${bookingId}-${item.id}`,
      },
    );
    // Optimistic flip via the shared helper — instant tick, rollback + one-tap
    // Retry on a real failure; queued (no rollback) when we're simply offline.
    void runOptimistic({
      apply: () =>
        setServerItems((cur) =>
          cur.map((it) =>
            it.id === item.id
              ? { ...it, checked: nextChecked, checked_at: nextChecked ? new Date().toISOString() : null }
              : it,
          ),
        ),
      // Item-scoped rollback (NOT a whole-list snapshot restore): revert only
      // THIS item so a failed tick can't wipe a concurrent tick that was applied
      // after this one's snapshot — the apply is per-item, so the rollback must
      // be too. Uses a functional updater against the live list.
      rollback: () =>
        setServerItems((cur) =>
          cur.map((it) =>
            it.id === item.id
              ? { ...it, checked: item.checked, checked_at: item.checked_at }
              : it,
          ),
        ),
      ...q,
      errorMessage: "Couldn't update the checklist. Please try again.",
      retry: true,
      // Silent while offline: a shopper ticks a dozen lines in a row and the
      // global OfflineBanner already says why. The tick staying ticked IS the
      // confirmation — a toast per item would be noise, not information.
      offlineMessage: null,
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
    <>
    <Card className="p-4 mb-3">
      <Pressable
        onPress={() => setExpanded(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
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
                      onPress={() => setPhotoUri(uri)}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open item photo ${i + 1}`}
                      style={{ marginRight: 8 }}
                    >
                      <Image
                        source={mediaSource(photo)}
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
      <ImageLightbox
        uri={photoUri}
        visible={!!photoUri}
        onClose={() => setPhotoUri(null)}
      />
    </>
  );
}
