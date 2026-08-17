import api from './api';
import { invalidateQuery } from '../hooks/useQuery';

const invalidateWallet = () => {
  invalidateQuery(['wallet']);
};
const invalidatePaymentMethods = () => {
  invalidateQuery(['payment-methods']);
};

export const paymentService = {
  getPaymentMethods() {
    return api.get('/payments/methods', { cacheTtlMs: 30_000, silent: true });
  },

  // Platform-offered methods (operator-managed). The selector shows only these.
  getAvailableMethods() {
    return api.get('/payments/available-methods', { cacheTtlMs: 60_000, silent: true });
  },

  addPaymentMethod(data: {
    type: 'card' | 'gcash' | 'maya';
    gateway_token: string;
    label?: string;
  }) {
    const p = api.post('/payments/methods', data);
    p.then(invalidatePaymentMethods).catch(() => {});
    return p;
  },

  // Start linking a reusable e-wallet (GCash/Maya/GrabPay). Returns an
  // `action_url` the app opens for the customer to authorize; the method
  // becomes usable once Xendit fires payment_method.activated.
  linkEwallet(channel: 'gcash' | 'maya' | 'grabpay') {
    const p = api.post('/payments/methods/link', { channel });
    p.then(invalidatePaymentMethods).catch(() => {});
    return p;
  },

  removePaymentMethod(id: string) {
    const p = api.delete(`/payments/methods/${id}`);
    p.then(invalidatePaymentMethods).catch(() => {});
    return p;
  },

  setDefaultMethod(id: string) {
    const p = api.put(`/payments/methods/${id}/default`);
    p.then(invalidatePaymentMethods).catch(() => {});
    return p;
  },

  getWalletBalance() {
    return api.get('/wallet/balance', { cacheTtlMs: 15_000, silent: true });
  },

  // payment_method_id is optional — the Xendit hosted invoice lets the
  // customer choose GCash / Maya / card at checkout. Returns a
  // `checkout_url` the app must open; the wallet is credited only after
  // Xendit confirms via webhook.
  topUpWallet(
    // `method` (gcash|maya|card): gcash/maya charge directly and deep-link into
    // the wallet app (no hosted page); card / omitted → the hosted invoice.
    data: { amount: number; method?: 'gcash' | 'maya' | 'card'; payment_method_id?: string },
    opts?: { idempotencyKey?: string },
  ) {
    const p = api.post('/wallet/top-up', data, { idempotencyKey: opts?.idempotencyKey });
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

  // Status probe for a single wallet top-up.
  getTopUpStatus(transactionId: string) {
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
