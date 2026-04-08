import { create } from 'zustand';
import type { WalletTransaction, PaymentMethod } from '../types';

interface WalletState {
  balance: number;
  transactions: WalletTransaction[];
  paymentMethods: PaymentMethod[];
  isLoading: boolean;

  setBalance: (balance: number) => void;
  addTransaction: (transaction: WalletTransaction) => void;
  setTransactions: (transactions: WalletTransaction[]) => void;
  setPaymentMethods: (methods: PaymentMethod[]) => void;
  setDefaultMethod: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  balance: 0,
  transactions: [],
  paymentMethods: [],
  isLoading: false,

  setBalance: (balance) => set({ balance }),

  addTransaction: (transaction) =>
    set((state) => ({
      transactions: [transaction, ...state.transactions],
      balance: transaction.balance_after,
    })),

  setTransactions: (transactions) => set({ transactions }),

  setPaymentMethods: (methods) => set({ paymentMethods: methods }),

  setDefaultMethod: (id) =>
    set((state) => ({
      paymentMethods: state.paymentMethods.map((m) => ({
        ...m,
        is_default: m.id === id,
      })),
    })),

  setIsLoading: (loading) => set({ isLoading: loading }),
}));
