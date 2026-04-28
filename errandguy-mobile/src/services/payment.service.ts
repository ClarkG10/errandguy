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
    return api.get('/payments/methods', { cacheTtlMs: 30_000 } as any);
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
    return api.get('/wallet/balance', { cacheTtlMs: 15_000 } as any);
  },

  topUpWallet(data: { amount: number; payment_method_id: string }) {
    const p = api.post('/wallet/top-up', data);
    p.then(invalidateWallet).catch(() => {});
    return p;
  },

  getWalletTransactions(params?: { page?: number; per_page?: number }) {
    return api.get('/wallet/transactions', { params, cacheTtlMs: 15_000 } as any);
  },

  getPaymentHistory(params?: { page?: number; per_page?: number }) {
    return api.get('/payments/history', { params, cacheTtlMs: 15_000 } as any);
  },

  getReceipt(id: string) {
    return api.get(`/payments/${id}/receipt`, { cacheTtlMs: 60_000 } as any);
  },
};
