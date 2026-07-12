import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

/** Optional inline action rendered on the right edge of the toast
 *  (e.g. "Undo", "View"). Tapping it fires onAction and dismisses. */
export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastStore {
  toasts: ToastItem[];
  show: (variant: ToastVariant, message: string, options?: ToastOptions) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let _nextId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  show: (variant, message, options) => {
    const id = `toast_${++_nextId}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant, ...options }] }));
  },

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

/** Convenience shorthand – call from anywhere including outside React */
export const toast = {
  success: (msg: string, options?: ToastOptions) => useToastStore.getState().show('success', msg, options),
  error: (msg: string, options?: ToastOptions) => useToastStore.getState().show('error', msg, options),
  info: (msg: string, options?: ToastOptions) => useToastStore.getState().show('info', msg, options),
  warning: (msg: string, options?: ToastOptions) => useToastStore.getState().show('warning', msg, options),
};
