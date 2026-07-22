import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { newIdempotencyKey } from '../utils/idempotency';

/**
 * Tracks the single in-flight money attempt so it can be VERIFIED — not
 * assumed — even if the user leaves the screen, backgrounds the app, or the
 * process is killed mid-payment. The attempt is persisted synchronously (a
 * money attempt must never be lost to a crash between writes — unlike the
 * booking draft, we do NOT debounce) and rehydrated on launch so
 * `usePaymentVerification` can resume polling and land the user on the outcome.
 *
 * Mirrors the hand-rolled AsyncStorage + `isHydrated` pattern of bookingStore
 * (no zustand persist middleware, to match the codebase).
 */
export type PaymentKind = 'booking' | 'topup' | 'payout';

export type AttemptStatus =
  | 'preparing' // creating the booking/top-up/payout on our server
  | 'awaiting_gateway' // handed a checkout URL, user is in Xendit
  | 'verifying' // back from checkout, polling the backend for the truth
  | 'pending' // still unconfirmed after a while — safe to leave, we'll notify
  | 'success' // backend confirmed the money moved
  | 'failed'; // backend confirmed failure/expiry

export interface PaymentAttempt {
  attemptId: string;
  /** Sent as Idempotency-Key; REUSED across retries of THIS attempt. */
  idempotencyKey: string;
  kind: PaymentKind;
  bookingId?: string;
  topupId?: string;
  /** Filled from the create response so we can poll /payments/{id}/status. */
  paymentId?: string;
  amount: number;
  method?: string;
  reference?: string;
  /** The gateway checkout/invoice URL — reused so a failed-payment "Try again"
   *  re-opens the SAME invoice instead of creating a duplicate booking. */
  checkoutUrl?: string;
  status: AttemptStatus;
  failureReason?: string;
  paidAt?: string;
  startedAt: number;
  updatedAt: number;
}

const STORAGE_KEY = '@payment_attempt_v1';
/** Older than this on hydrate → dropped (a long-dead attempt is noise). */
const ATTEMPT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

const TERMINAL: AttemptStatus[] = ['success', 'failed'];

export const isAttemptTerminal = (a?: PaymentAttempt | null): boolean =>
  !!a && TERMINAL.includes(a.status);

/** An attempt that still owns the "one payment at a time" lock. */
export const isAttemptActive = (a?: PaymentAttempt | null): boolean =>
  !!a && !TERMINAL.includes(a.status);

const persist = (attempt: PaymentAttempt | null) => {
  // Synchronous write — no debounce. Losing an in-flight money attempt to a
  // crash is worse than an extra AsyncStorage write.
  if (!attempt) {
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  } else {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(attempt)).catch(() => {});
  }
};

interface PaymentStoreState {
  attempt: PaymentAttempt | null;
  isHydrated: boolean;

  /** Mint a new attempt (new attemptId + idempotencyKey) and persist it. */
  beginAttempt: (init: {
    kind: PaymentKind;
    amount: number;
    method?: string;
    bookingId?: string;
    topupId?: string;
  }) => PaymentAttempt;
  /** Record the server payment id once the create response returns. */
  linkPayment: (paymentId: string) => void;
  /** Advance the attempt's status (and any known fields). No-op if cleared. */
  setStatus: (status: AttemptStatus, patch?: Partial<PaymentAttempt>) => void;
  /** Clear the attempt (user acknowledged a terminal outcome, or gave up). */
  resolve: () => void;
  loadFromStorage: () => Promise<void>;
}

export const usePaymentStore = create<PaymentStoreState>((set, get) => ({
  attempt: null,
  isHydrated: false,

  beginAttempt: (init) => {
    const now = Date.now();
    const attempt: PaymentAttempt = {
      attemptId: newIdempotencyKey(),
      idempotencyKey: newIdempotencyKey(),
      kind: init.kind,
      bookingId: init.bookingId,
      topupId: init.topupId,
      amount: init.amount,
      method: init.method,
      status: 'preparing',
      startedAt: now,
      updatedAt: now,
    };
    set({ attempt });
    persist(attempt);
    return attempt;
  },

  linkPayment: (paymentId) => {
    const current = get().attempt;
    if (!current) return;
    const attempt = { ...current, paymentId, updatedAt: Date.now() };
    set({ attempt });
    persist(attempt);
  },

  setStatus: (status, patch) => {
    const current = get().attempt;
    if (!current) return;
    const attempt = { ...current, ...patch, status, updatedAt: Date.now() };
    set({ attempt });
    persist(attempt);
  },

  resolve: () => {
    set({ attempt: null });
    persist(null);
  },

  loadFromStorage: async () => {
    if (get().isHydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        set({ isHydrated: true });
        return;
      }
      const attempt = JSON.parse(raw) as PaymentAttempt;
      const stale =
        !attempt?.startedAt || Date.now() - attempt.startedAt > ATTEMPT_MAX_AGE_MS;
      // Drop stale, and drop already-concluded attempts — a terminal outcome
      // shouldn't re-hijack the UI on every relaunch. Non-terminal attempts are
      // kept so verification can resume.
      if (stale || isAttemptTerminal(attempt)) {
        await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
        set({ isHydrated: true });
        return;
      }
      set({ attempt, isHydrated: true });
    } catch {
      await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      set({ isHydrated: true });
    }
  },
}));
