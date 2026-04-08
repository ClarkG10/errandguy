import api from './api';

export const paymentService = {
  getPaymentMethods() {
    return api.get('/payments/methods');
  },

  addPaymentMethod(data: {
    type: 'card' | 'gcash' | 'maya';
    gateway_token: string;
    label?: string;
  }) {
    return api.post('/payments/methods', data);
  },

  removePaymentMethod(id: string) {
    return api.delete(`/payments/methods/${id}`);
  },

  setDefaultMethod(id: string) {
    return api.put(`/payments/methods/${id}/default`);
  },

  getWalletBalance() {
    return api.get('/wallet/balance');
  },

  topUpWallet(data: { amount: number; payment_method_id: string }) {
    return api.post('/wallet/top-up', data);
  },

  getWalletTransactions(params?: { page?: number; per_page?: number }) {
    return api.get('/wallet/transactions', { params });
  },

  getPaymentHistory(params?: { page?: number; per_page?: number }) {
    return api.get('/payments/history', { params });
  },

  getReceipt(id: string) {
    return api.get(`/payments/${id}/receipt`);
  },
};
