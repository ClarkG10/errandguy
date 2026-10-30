import api from './api';
import { invalidateQuery } from '../hooks/useQuery';
import type { WalletSummary } from '../types';

const invalidateWallet = () => {
  invalidateQuery(['wallet']);
};

/** POST /wallet/withdraw body — a customer's withdrawal to GCash or Maya. */
export interface WithdrawalRequest {
  amount: number;
  channel: 'gcash' | 'maya';
  /** 09XXXXXXXXX or +639XXXXXXXXX */
  account_number: string;
  account_name: string;
}

/**
 * GET /wallet/balance → `data`, normalized to numbers.
 *
 * Laravel serializes decimals as strings, and a server from before the launch
 * simplification sends `balance` alone — so `withdrawable` is derived from it
 * (never below zero) and a missing `bonus_balance` reads as none.
 */
export function parseWalletSummary(payload: unknown): WalletSummary {
  const p = (payload ?? {}) as Partial<Record<keyof WalletSummary, unknown>>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const balance = num(p.balance);
  return {
    balance,
    withdrawable: p.withdrawable != null ? Math.max(0, num(p.withdrawable)) : Math.max(0, balance),
    bonus_balance: Math.max(0, num(p.bonus_balance)),
  };
}

export const paymentService = {
  // Platform-offered methods (operator-managed): the enabled subset of
  // wallet, gcash, maya and cash. The selector shows only these.
  getAvailableMethods() {
    return api.get('/payments/available-methods', { cacheTtlMs: 60_000, silent: true });
  },

  getWalletBalance() {
    return api.get('/wallet/balance', { cacheTtlMs: 15_000, silent: true });
  },

  /**
   * Withdraw wallet money to GCash or Maya (customers only).
   *
   * The Idempotency-Key is REQUIRED (the server answers 428 without one) and
   * becomes the payout's reference, so a double-tap or a retry of the same
   * withdrawal returns the first one instead of debiting twice. The money is
   * debited now and staff send it, so the result is a PENDING payout row.
   */
  withdraw(data: WithdrawalRequest, opts: { idempotencyKey: string }) {
    const p = api.post('/wallet/withdraw', data, { idempotencyKey: opts.idempotencyKey });
    p.then(invalidateWallet).catch(() => {});
    return p;
  },

  // Authoritative status probe the app polls to VERIFY a charge (never assume).
  // noCache/noDedupe are essential — the 8s micro-cache would otherwise pin a
  // stale `pending` and the poll would never observe settlement. `silent` keeps
  // the global activity bar from pinning during background polling.
  getPaymentStatus(paymentId: string) {
    return api.get(`/payments/${paymentId}/status`, {
      noCache: true,
      noDedupe: true,
      silent: true,
    });
  },

  // Same, addressed by booking id (deep-link return may only know the booking).
  getBookingPaymentStatus(bookingId: string) {
    return api.get(`/bookings/${bookingId}/payment-status`, {
      noCache: true,
      noDedupe: true,
      silent: true,
    });
  },

  // Status probe for a single wallet transaction — a GCash/Maya tip charge.
  getTransactionStatus(transactionId: string) {
    return api.get(`/wallet/transactions/${transactionId}/status`, {
      noCache: true,
      noDedupe: true,
      silent: true,
    });
  },

  // Server-side filters (WalletController::transactions): `type` narrows to
  // a single WalletTransactionType, `date_from` / `date_to` bound the range
  // (parsed as start/end of day server-side).
  getWalletTransactions(params?: {
    page?: number;
    per_page?: number;
    type?: string;
    date_from?: string;
    date_to?: string;
  }) {
    return api.get('/wallet/transactions', { params, cacheTtlMs: 15_000, silent: true });
  },

  getPaymentHistory(params?: { page?: number; per_page?: number }) {
    return api.get('/payments/history', { params, cacheTtlMs: 15_000 });
  },

  getReceipt(id: string) {
    return api.get(`/payments/${id}/receipt`, { cacheTtlMs: 60_000 });
  },
};
