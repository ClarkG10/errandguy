import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Clock, Package, Coins } from 'lucide-react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { LightColors } from '../../constants/colors';
import { formatCurrency } from '../../utils/formatCurrency';
import type { ShiftSummary } from '../../types/runner';

/**
 * "Here's what that shift came to."
 *
 * A runner used to clock off into silence: to find out what they'd just earned
 * they had to open the earnings tab and work out for themselves which rows
 * belonged to the hours they'd worked. This closes the shift with the figure
 * they actually want, at the moment they want it.
 *
 * Money honesty, which is the whole reason this is worth building at all:
 * `earnings` is payout ONLY and tips are shown as their own line, never added
 * in. That matches the earnings screen, the CSV and the PDF statement — a card
 * that quietly folded tips into the headline would disagree with the very
 * screen the runner checks next, and there is no worse place to be
 * approximately right than money.
 */
interface Props {
  shift: ShiftSummary | null;
  onClose: () => void;
}

/** "6h 20m" / "45m" — never "0.75 hours", which nobody thinks in. */
export function formatDuration(minutes: number): string {
  const safe = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function ShiftSummarySheet({ shift, onClose }: Props) {
  const router = useRouter();

  const rows = shift
    ? [
        {
          key: 'time',
          icon: <Clock size={18} color={LightColors.textSecondary} strokeWidth={2.2} />,
          label: 'Time online',
          value: formatDuration(shift.minutes_online),
        },
        {
          key: 'errands',
          icon: <Package size={18} color={LightColors.textSecondary} strokeWidth={2.2} />,
          label: shift.errands === 1 ? 'Errand completed' : 'Errands completed',
          value: String(shift.errands),
        },
        // Tips are their OWN row and are deliberately absent from the headline
        // above. Only shown when there are any — a "₱0.00 in tips" line on a
        // shift with no tips reads as a reproach.
        ...(shift.tips > 0
          ? [
              {
                key: 'tips',
                icon: <Coins size={18} color={LightColors.accentDark} strokeWidth={2.2} />,
                label: 'Tips (on top)',
                value: formatCurrency(shift.tips),
              },
            ]
          : []),
      ]
    : [];

  return (
    <BottomSheet isVisible={!!shift} onClose={onClose} snapPoints={[0.5]}>
      <View className="px-5 pb-2">
        <Text
          className="text-[13px] font-inter text-textSecondary"
          accessibilityRole="header"
        >
          Shift complete
        </Text>

        {/* The number they came for. Payout only — see the note above. */}
        <Text className="text-[34px] font-montserrat-bold tabular-nums text-textPrimary mt-1">
          {formatCurrency(shift?.earnings ?? 0)}
        </Text>
        <Text className="text-[12px] font-inter text-textMuted mt-0.5">
          {shift && shift.tips > 0 ? 'earned, plus tips below' : 'earned this shift'}
        </Text>

        <View className="mt-5">
          {rows.map((row) => (
            <View
              key={row.key}
              className="flex-row items-center justify-between py-3 border-b"
              style={{ borderBottomColor: LightColors.divider }}
              accessibilityLabel={`${row.label}: ${row.value}`}
            >
              <View className="flex-row items-center">
                {row.icon}
                <Text className="text-[14px] font-inter text-textSecondary ml-2.5">
                  {row.label}
                </Text>
              </View>
              <Text className="text-[15px] font-inter-semi tabular-nums text-textPrimary">
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {shift?.errands === 0 && (
          <Text className="text-[12px] font-inter text-textMuted mt-4">
            No errands came through this time. Busier hours are usually lunch and
            early evening — the demand map shows where.
          </Text>
        )}

        <View className="mt-6">
          <Button
            title="See my earnings"
            variant="secondary"
            fullWidth
            onPress={() => {
              onClose();
              router.push('/(runner)/(tabs)/earnings');
            }}
          />
          <View className="h-2" />
          <Button title="Done" fullWidth onPress={onClose} />
        </View>
      </View>
    </BottomSheet>
  );
}
