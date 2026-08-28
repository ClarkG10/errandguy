import React from 'react';
import { View, Text } from 'react-native';
import {
  Coins,
  Percent,
  Gift,
  RotateCcw,
  ArrowUpRight,
  SlidersHorizontal,
  Star,
  Wallet,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRelativeTime } from '../../utils/formatDate';
import { LightColors } from '../../constants/colors';
import type { WalletTransaction } from '../../types';

/**
 * One row of the runner's wallet ledger.
 *
 * The runner app only ever listed `payout` rows, so the movements that
 * silently change a runner's balance — the cash-errand platform commission,
 * admin adjustments, failed-payout re-credits, tips, late-settled earnings —
 * had nowhere to be seen. This renders whatever `GET /wallet/transactions`
 * returns, including types the mobile `WalletTransactionType` union does not
 * declare yet (the server writes `commission` rows), which is why the icon
 * map is keyed by plain string with a neutral fallback.
 */

const TYPE_ICONS: Record<string, { icon: LucideIcon; color: string }> = {
  earning: { icon: Coins, color: LightColors.success },
  commission: { icon: Percent, color: LightColors.textSecondary },
  tip: { icon: Gift, color: LightColors.accentStrong },
  bonus: { icon: Star, color: LightColors.accentStrong },
  refund: { icon: RotateCcw, color: LightColors.primary },
  payout: { icon: ArrowUpRight, color: LightColors.primary },
  adjustment: { icon: SlidersHorizontal, color: LightColors.primary },
  top_up: { icon: Wallet, color: LightColors.success },
  payment: { icon: Wallet, color: LightColors.textSecondary },
};

/** Fallback label when the server sends no description for a row. */
const titleCase = (t: string) =>
  t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * A `reversed` payout is a real lifecycle state the server writes
 * (WalletService::reversePayout) but the mobile status union doesn't declare.
 * Read it as a plain string so a reversed row never falls through to
 * "Pending" — the bug that had runners waiting for money already re-credited.
 */
export const readTxStatus = (tx: WalletTransaction): string =>
  String(tx.status ?? 'completed');

export interface TxStatusChip {
  label: string;
  color: string;
}

export function walletStatusChip(tx: WalletTransaction): TxStatusChip | null {
  switch (readTxStatus(tx)) {
    case 'pending':
      // *Dark rung — base warning fails AA at these sizes (colors.ts).
      return { label: 'Pending', color: LightColors.warningDark };
    case 'failed':
      return { label: 'Failed', color: LightColors.dangerDark };
    case 'reversed':
      return { label: 'Returned to balance', color: LightColors.primaryDark };
    default:
      return null;
  }
}

interface WalletActivityRowProps {
  tx: WalletTransaction;
  /** Draw a hairline under the row. */
  divider?: boolean;
}

export function WalletActivityRow({ tx, divider = true }: WalletActivityRowProps) {
  const config = TYPE_ICONS[tx.type as string] ?? {
    icon: Wallet,
    color: LightColors.textSecondary,
  };
  const Icon = config.icon;

  // For runner-side rows the SIGN of the stored amount is the source of truth
  // for credit-vs-debit (an earning and a tip are positive, a commission and a
  // payout are negative) — never the type name.
  const amount = Number(tx.amount ?? 0);
  const isCredit = amount >= 0;

  const status = readTxStatus(tx);
  const settled = status !== 'pending' && status !== 'failed';
  const chip = walletStatusChip(tx);

  const amountClass = !settled
    ? 'text-textMuted'
    : isCredit
      ? 'text-successDark'
      : 'text-textPrimary';

  return (
    <View
      className={`flex-row items-start bg-surface px-4 py-3 ${
        divider ? 'border-b border-divider' : ''
      }`}
    >
      <View className="w-9 h-9 rounded-full bg-surfaceMuted items-center justify-center">
        <Icon
          size={17}
          color={settled ? config.color : LightColors.textMuted}
          strokeWidth={1.8}
        />
      </View>
      <View className="flex-1 ml-3">
        <Text className="text-[13px] font-montserrat-bold text-textPrimary" numberOfLines={2}>
          {tx.display_description ?? tx.description ?? titleCase(String(tx.type))}
        </Text>
        <View className="flex-row items-center flex-wrap mt-0.5">
          <Text className="text-[11px] font-montserrat text-textSecondary">
            {formatRelativeTime(tx.created_at)}
          </Text>
          {chip && (
            <Text
              className="text-[11px] font-montserrat-semi ml-1.5"
              style={{ color: chip.color }}
            >
              · {chip.label}
            </Text>
          )}
        </View>
        {status === 'failed' && tx.failure_reason ? (
          <Text className="text-[11px] font-montserrat text-dangerDark mt-0.5" numberOfLines={2}>
            {tx.failure_reason}
          </Text>
        ) : null}
      </View>
      <View className="items-end ml-2">
        <Text className={`text-[14px] font-inter-semi tabular-nums ${amountClass}`}>
          {/* No sign on an unsettled row — a sign implies the money moved. */}
          {!settled ? '' : isCredit ? '+' : '−'}
          {formatCurrency(Math.abs(amount))}
        </Text>
        {settled && tx.balance_after != null ? (
          <Text className="text-[10px] font-inter tabular-nums text-textMuted mt-0.5">
            Bal {formatCurrency(Number(tx.balance_after))}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
