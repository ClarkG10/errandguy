import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastStore {
  toasts: ToastItem[];
  show: (variant: ToastVariant, message: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let _nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  show: (variant, message) => {
    const id = `toast_${++_nextId}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
  },

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

/** Convenience shorthand – call from anywhere including outside React */
export const toast = {
  success: (msg: string) => useToastStore.getState().show('success', msg),
  error: (msg: string) => useToastStore.getState().show('error', msg),
  info: (msg: string) => useToastStore.getState().show('info', msg),
  warning: (msg: string) => useToastStore.getState().show('warning', msg),
};
