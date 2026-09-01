import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';
import { LightColors } from '../../constants/colors';
import {
  shoppingProgress,
  type ShoppingProgressItem,
} from '../../utils/shoppingChecklist';

/**
 * READ-ONLY customer mirror of the runner's shopping checklist.
 *
 * The runner ticks items off in their cockpit (ErrandDetailsCard) and every
 * tick is written to `booking.shopping_items` server-side, then pushed to the
 * customer as a `shopping_items_updated` in-app notification. Until this card
 * existed the customer had nowhere to SEE that: the tracking screen showed a
 * map dot and "Actual paid — ", so the only way to ask "did you find the
 * milk?" was to message the runner.
 *
 * Deliberately not tickable and deliberately not a duplicate of the runner
 * component: the customer never owns the tick state, so this renders the same
 * visual language (checkbox, strike-through, ×qty) with no press targets on
 * the rows.
 */

/** Rows shown before the list collapses behind "Show all N items". */
const COLLAPSED_ROWS = 6;
/** Lists longer than this collapse by default. */
const COLLAPSE_THRESHOLD = 8;

export interface ShoppingProgressCardProps {
  items: ShoppingProgressItem[] | null | undefined;
  /**
   * `true` while the errand is still running — adds the "ticks land here
   * live" reassurance line. On a terminal receipt the list is a record of
   * what was picked up, so the live copy would be misleading.
   */
  live?: boolean;
}

export function ShoppingProgressCard({ items, live = false }: ShoppingProgressCardProps) {
  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const { picked, total, ratio, allPicked } = shoppingProgress(list);
  const collapsible = total > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  if (total === 0) return null;

  const visible = collapsible && !expanded ? list.slice(0, COLLAPSED_ROWS) : list;

  return (
    <View className="bg-primary/5 border border-primary/30 rounded-xl p-4">
      <View
        className="flex-row items-center justify-between mb-2"
        accessible
        accessibilityRole="header"
        accessibilityLabel={`Shopping progress: ${picked} of ${total} items picked`}
      >
        <Text className="text-xs font-montserrat-bold text-primary uppercase">
          Shopping progress
        </Text>
        <Text className="text-xs font-montserrat-bold text-primary">
          {picked} of {total} picked
        </Text>
      </View>

      {/* Progress rail — the one glanceable signal. Width is a percentage so
          it needs no measurement pass. */}
      <View
        className="rounded-full overflow-hidden mb-3"
        style={{ height: 6, backgroundColor: LightColors.primarySoft }}
      >
        <View
          style={{
            width: `${Math.round(ratio * 100)}%`,
            height: '100%',
            borderRadius: 999,
            backgroundColor: LightColors.primary,
          }}
        />
      </View>

      {visible.map((item) => {
        const checked = !!item.checked;
        return (
          <View
            key={item.id}
            className="flex-row items-center py-1.5"
            accessible
            accessibilityLabel={`${item.name}, quantity ${item.qty}, ${
              checked ? 'picked up' : 'not picked yet'
            }`}
          >
            <View
              className="items-center justify-center rounded-md mr-3"
              style={{
                width: 20,
                height: 20,
                borderWidth: checked ? 0 : 1.5,
                borderColor: LightColors.dividerStrong,
                backgroundColor: checked ? LightColors.primary : 'transparent',
              }}
            >
              {checked && <Check size={13} color={LightColors.textInverse} strokeWidth={3} />}
            </View>
            <Text
              className="flex-1 text-sm font-montserrat text-textPrimary"
              style={
                checked
                  ? { textDecorationLine: 'line-through', color: LightColors.textTertiary }
                  : undefined
              }
            >
              {item.name}
            </Text>
            <Text className="text-sm font-montserrat-bold text-textSecondary ml-2">
              ×{item.qty}
            </Text>
          </View>
        );
      })}

      {collapsible && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show fewer items' : `Show all ${total} items`}
          // The row is ~16pt tall; slop lifts the target past the 44pt floor.
          hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
          // Layout lives in className, never in the style callback — a
          // Pressable styled only through style={() => [obj]} drops
          // flexDirection on Android.
          className="flex-row items-center mt-2"
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <Text className="text-xs font-montserrat-semi text-primary mr-1">
            {expanded ? 'Show fewer' : `Show all ${total} items`}
          </Text>
          {expanded ? (
            <ChevronUp size={13} color={LightColors.primary} />
          ) : (
            <ChevronDown size={13} color={LightColors.primary} />
          )}
        </Pressable>
      )}

      {live && (
        <Text className="text-xs font-montserrat text-textTertiary mt-3">
          {allPicked
            ? 'Everything on your list is picked up. Your runner will upload the receipt next.'
            : 'Items tick off here as your runner picks them up.'}
        </Text>
      )}
    </View>
  );
}
