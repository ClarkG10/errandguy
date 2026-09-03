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
// 'tip' is a gateway-funded runner tip. It behaves like 'topup' for
// verification — a wallet_transaction polled via the shared transaction-status
// endpoint — so its transaction id rides in `topupId`.
export type PaymentKind = 'booking' | 'topup' | 'payout' | 'tip';

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

/**
 * Should a failed money-CREATE keep its idempotency key for the next try?
 *
 * The key exists for exactly one failure class: the one where the client
 * cannot tell whether the server did the work. Mutations get a flat 30s
 * timeout and no retry layer (api.ts), so a slow create — a Xendit invoice on
 * provincial LTE — can time out client-side while the server completes it. If
 * the retry then mints a FRESH key, the backend (which looks up
 * user_id + idem_key) has no way to connect the two and books/charges twice.
 *
 * So: retain the key whenever the outcome is genuinely unknown or explicitly
 * "still running", and drop it only when the server gave a definitive verdict
 * on its own terms (a 4xx), which is a real new attempt.
 *
 *   • status 0  → offline / client timeout: no response, outcome UNKNOWN.
 *   • status 5xx → EnsureIdempotency releases the claim on a 5xx, so the same
 *     key runs cleanly again (and a partial server-side write is deduped).
 *   • status 409 → the FIRST request with this key is still in flight. Minting
 *     a new key here is the double-book, so this one is critical.
 *   • any other 4xx → definitive rejection (validation, promo dead, gateway
 *     refusal); the next Confirm is a genuinely new attempt.
 *
 * Callers hold the key in a screen-local ref (see (runner)/payout/index.tsx)
 * rather than in the persisted attempt, so retaining it never also retains the
 * one-payment-at-a-time lock.
 */
export const shouldRetainIdempotencyKey = (err: unknown): boolean => {
  const status = (err as { status?: number } | null | undefined)?.status;
  if (typeof status !== 'number') return true; // shape we don't recognise → assume unknown
  return status === 0 || status === 409 || status >= 500;
};

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

  /**
   * Mint a new attempt (new attemptId + idempotencyKey) and persist it.
   *
   * `idempotencyKey` lets the calling screen supply a RETAINED key (held in a
   * screen-local ref across a transport-class failure — see
   * shouldRetainIdempotencyKey) so a retry of the same create is deduped
   * server-side instead of booking/charging twice. Omit it for a genuinely new
   * attempt and a fresh key is minted.
   */
  beginAttempt: (init: {
    kind: PaymentKind;
    amount: number;
    method?: string;
    bookingId?: string;
    topupId?: string;
    idempotencyKey?: string;
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
      idempotencyKey: init.idempotencyKey ?? newIdempotencyKey(),
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
      // shouldn't re-hijack the UI on every relaunch. Also drop a rehydrated
      // 'preparing' attempt: it's the pre-create state, so it holds no server
      // reference (paymentId/bookingId/topupId/checkoutUrl) to resume or verify
      // and no gateway charge has happened yet — but it IS "active", so keeping
      // it would hold the one-payment-at-a-time lock forever and silently block
      // every future booking AND top-up (neither poll nor safety-net clears it).
      // Live-session 'preparing' attempts are untouched (only rehydrate drops).
      if (stale || isAttemptTerminal(attempt) || attempt?.status === 'preparing') {
        await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
        set({ isHydrated: true });
        return;
      }
      // Never RESUME into a non-dismissable overlay. 'verifying' and
      // 'awaiting_gateway' render a button-less full-screen Modal
      // (PaymentProgress), so if the status endpoint is erroring, a rehydrated
      // attempt in one of those states would re-trap the user on EVERY relaunch
      // (which is exactly why reloading never un-sticks the app). Bring it back
      // as the honest, dismissable 'pending' state instead — still polled, still
      // lands the real outcome, but the user can always leave.
      const resumed: PaymentAttempt =
        attempt.status === 'verifying' || attempt.status === 'awaiting_gateway'
          ? { ...attempt, status: 'pending' }
          : attempt;
      set({ attempt: resumed, isHydrated: true });
    } catch {
      await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      set({ isHydrated: true });
    }
  },
}));
