import {
  ArrowDownCircle,
  ArrowUpCircle,
  Coins,
  Gift,
  HandCoins,
  Percent,
  RotateCcw,
  SlidersHorizontal,
  Star,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { LightColors } from '../constants/colors';
import type { WalletTransaction, WalletTransactionType } from '../types';

/**
 * How a customer-facing surface (the Wallet screen, universal search) draws a
 * wallet ledger row: its glyph, and which way the money moved.
 */
export const LEDGER_ICONS: Record<WalletTransactionType, { icon: LucideIcon; color: string }> = {
  payment: { icon: ArrowDownCircle, color: LightColors.danger },
  refund: { icon: RotateCcw, color: LightColors.primary },
  payout: { icon: ArrowDownCircle, color: LightColors.warning },
  tip: { icon: Gift, color: LightColors.accentStrong },
  earning: { icon: Coins, color: LightColors.success },
  adjustment: { icon: SlidersHorizontal, color: LightColors.primary },
  commission: { icon: Percent, color: LightColors.textSecondary },
  cancel_fee: { icon: HandCoins, color: LightColors.success },
  // Legacy rows (top-ups and referral bonuses are retired).
  top_up: { icon: ArrowUpCircle, color: LightColors.success },
  bonus: { icon: Star, color: LightColors.accentStrong },
};

export const ledgerIcon = (type: string) =>
  LEDGER_ICONS[type as WalletTransactionType] ?? LEDGER_ICONS.payment;

// Types whose stored `amount` is signed both ways (an admin adjustment, a tip,
// a runner earning or commission): the SIGN — not the type — decides
// credit-vs-debit.
const SIGNED_TYPES: ReadonlySet<string> = new Set(['tip', 'earning', 'adjustment', 'commission']);

// Fixed-direction credits. Everything else of fixed direction (a payment, a
// payout or withdrawal) is a debit, whatever sign the amount was stored with.
const CREDIT_TYPES: ReadonlySet<string> = new Set(['refund', 'cancel_fee', 'top_up', 'bonus']);

/** Did this row ADD money to the wallet? */
export function isLedgerCredit(tx: Pick<WalletTransaction, 'type' | 'amount'>): boolean {
  if (SIGNED_TYPES.has(tx.type)) return Number(tx.amount) >= 0;
  return CREDIT_TYPES.has(tx.type);
}

/**
 * The row's amount with its real direction (credit +, debit −). `amount` is a
 * Laravel decimal and arrives as a string, so it is always coerced.
 */
export function signedLedgerAmount(tx: Pick<WalletTransaction, 'type' | 'amount'>): number {
  const magnitude = Math.abs(Number(tx.amount) || 0);
  return isLedgerCredit(tx) ? magnitude : -magnitude;
}
