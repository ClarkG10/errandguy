import React, { useCallback, useRef } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Plus, Minus, X } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import type { ChecklistItem } from '../../types/booking';

interface ShoppingChecklistProps {
  /** Section title — usually the errand type's descriptionLabel. */
  title: string;
  /** Controlled value. */
  value: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
  /** Fired after a row is removed (in addition to onChange) so the parent
   *  can offer an undo — onChange alone can't distinguish a removal from
   *  an edit. */
  onRemoveItem?: (item: ChecklistItem, index: number) => void;
  /** Validation error shown beneath the title. */
  error?: string;
}

/** Lightweight unique id for a freshly-added row. */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const lightImpact = () =>
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

/**
 * Customer-facing shopping-list builder. Each row is a free-text item name
 * with a −/+ quantity stepper and a remove control; an "Add item"
 * affordance appends a new blank row. Fully controlled via `value` /
 * `onChange`.
 *
 * The list is later serialized into the booking's free-text `description`
 * at submit (there is no structured items column on the API).
 */
export function ShoppingChecklist({
  title,
  value,
  onChange,
  onRemoveItem,
  error,
}: ShoppingChecklistProps) {
  // Row inputs by item id — lets "Add item" and the keyboard "next" key
  // move focus without the user tapping into each fresh row.
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  const handleAdd = useCallback(() => {
    lightImpact();
    const id = newId();
    onChange([...value, { id, name: '', qty: 1 }]);
    // The new row's TextInput mounts on the next commit.
    requestAnimationFrame(() => inputRefs.current[id]?.focus());
  }, [value, onChange]);

  const handleRemove = useCallback(
    (id: string) => {
      lightImpact();
      const index = value.findIndex((item) => item.id === id);
      if (index < 0) return;
      const removed = value[index];
      delete inputRefs.current[id];
      onChange(value.filter((item) => item.id !== id));
      onRemoveItem?.(removed, index);
    },
    [value, onChange, onRemoveItem],
  );

  const handleName = useCallback(
    (id: string, name: string) => {
      onChange(value.map((item) => (item.id === id ? { ...item, name } : item)));
    },
    [value, onChange],
  );

  const handleQty = useCallback(
    (id: string, delta: number) => {
      lightImpact();
      onChange(
        value.map((item) =>
          item.id === id
            ? { ...item, qty: Math.max(1, item.qty + delta) }
            : item,
        ),
      );
    },
    [value, onChange],
  );

  return (
    <View style={st.wrap}>
      <View style={st.headerRow}>
        <Text style={[st.label, error ? { color: LightColors.dangerDark } : null]}>
          {title} *
        </Text>
        {value.length > 0 && (
          <Text style={st.count}>
            {value.length} {value.length === 1 ? 'item' : 'items'}
          </Text>
        )}
      </View>

      {value.length === 0 && (
        <Text style={st.emptyHint}>
          Add the items you need bought. Tap “Add item” to start your list.
        </Text>
      )}

      {value.map((item, idx) => (
        <View key={item.id} style={st.row}>
          <TextInput
            ref={(r) => {
              inputRefs.current[item.id] = r;
            }}
            style={st.nameInput}
            value={item.name}
            onChangeText={(t) => handleName(item.id, t)}
            placeholder={`Item ${idx + 1}`}
            placeholderTextColor={LightColors.textMuted}
            maxLength={80}
            accessibilityLabel={`Item ${idx + 1} name`}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              // Flow down the list; on the last filled row, grow it — a
              // whole grocery list can be typed without leaving the keys.
              const next = value[idx + 1];
              if (next) inputRefs.current[next.id]?.focus();
              else if (item.name.trim()) handleAdd();
              else inputRefs.current[item.id]?.blur();
            }}
          />

          <View style={st.stepper}>
            <Pressable
              onPress={() => handleQty(item.id, -1)}
              disabled={item.qty <= 1}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Decrease quantity of ${item.name || `item ${idx + 1}`}`}
              style={({ pressed }) => [st.stepBtn, pressed && st.pressed]}
            >
              <Minus
                size={16}
                color={item.qty <= 1 ? LightColors.textMuted : LightColors.primary}
                strokeWidth={2.4}
              />
            </Pressable>
            <Text style={st.qty} accessibilityLabel={`Quantity ${item.qty}`}>
              {item.qty}
            </Text>
            <Pressable
              onPress={() => handleQty(item.id, 1)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Increase quantity of ${item.name || `item ${idx + 1}`}`}
              style={({ pressed }) => [st.stepBtn, pressed && st.pressed]}
            >
              <Plus size={16} color={LightColors.primary} strokeWidth={2.4} />
            </Pressable>
          </View>

          <Pressable
            onPress={() => handleRemove(item.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name || `item ${idx + 1}`}`}
            style={({ pressed }) => [st.removeBtn, pressed && st.pressed]}
          >
            <X size={16} color={LightColors.textTertiary} strokeWidth={2.2} />
          </Pressable>
        </View>
      ))}

      <Pressable
        onPress={handleAdd}
        accessibilityRole="button"
        accessibilityLabel="Add item"
        // The chip is ~34pt tall — the slop lifts it past the 44pt floor.
        hitSlop={8}
        style={({ pressed }) => [
          st.addBtn,
          pressed && { backgroundColor: LightColors.primary100 },
        ]}
      >
        <Plus size={16} color={LightColors.primary} strokeWidth={2.4} />
        <Text style={st.addText}>Add item</Text>
      </Pressable>

      {error ? (
        <Text
          style={st.errorText}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textSecondary,
  },
  count: {
    fontSize: 12,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textTertiary,
  },
  emptyHint: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textTertiary,
    lineHeight: 17,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  nameInput: {
    flex: 1,
    minHeight: 44,
    backgroundColor: LightColors.surfaceMuted,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.textPrimary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LightColors.surfaceMuted,
    borderRadius: 12,
    height: 44,
    paddingHorizontal: 4,
  },
  stepBtn: {
    width: 34,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: {
    minWidth: 22,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  removeBtn: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.5,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: LightColors.surfaceMuted,
    marginTop: 2,
  },
  addText: {
    fontSize: 13,
    fontFamily: 'Quicksand_500Medium',
    color: LightColors.primary,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Quicksand_400Regular',
    // dangerDark: base danger is ~3.8:1 on white — below AA for 12px text.
    color: LightColors.dangerDark,
    marginTop: 8,
  },
});
