import { create } from 'zustand';
import type { WalletTransaction } from '../types';

interface WalletState {
  balance: number;
  transactions: WalletTransaction[];
  isLoading: boolean;

  setBalance: (balance: number) => void;
  addTransaction: (transaction: WalletTransaction) => void;
  setTransactions: (transactions: WalletTransaction[]) => void;
  setIsLoading: (loading: boolean) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  balance: 0,
  transactions: [],
  isLoading: false,

  setBalance: (balance) => set({ balance }),

  addTransaction: (transaction) =>
    set((state) => ({
      transactions: [transaction, ...state.transactions],
      balance: transaction.balance_after,
    })),

  setTransactions: (transactions) => set({ transactions }),

  setIsLoading: (loading) => set({ isLoading: loading }),
}));
