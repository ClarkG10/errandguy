import { create } from 'zustand';
import type { Booking, RunnerProfile, BookingStatus } from '../types';

interface IncomingRequest {
  booking: Booking;
  expiresAt: number;
}

interface Earnings {
  today: number;
  week: number;
  month: number;
  total: number;
}

/** Cap on the declined-offer memory — a shift's worth of "no thanks" is plenty
 *  and an unbounded set would grow for the life of the process. */
const MAX_DECLINED_OFFERS = 50;

interface RunnerState {
  isOnline: boolean;
  currentErrand: Booking | null;
  incomingRequest: IncomingRequest | null;
  earnings: Earnings;
  runnerProfile: RunnerProfile | null;
  /**
   * Offers the runner explicitly said no to, newest last.
   *
   * Lives in the store rather than a screen ref because the offer modal now
   * belongs to the runner LAYOUT (so an offer reaches a runner who is reading
   * Earnings) while the REST reconcile that can re-raise a still-`matched`
   * booking runs on Home. Two surfaces, one decision: without a shared memory,
   * a fire-and-forget decline whose POST failed would be re-raised 30s later by
   * the poller and the runner would be asked again.
   */
  declinedOfferIds: string[];

  toggleOnline: (status: boolean) => void;
  setIncomingRequest: (request: IncomingRequest | null) => void;
  clearIncomingRequest: () => void;
  acceptErrand: (booking: Booking) => void;
  /** Dismiss the open offer. Pass the booking id to also remember the decline. */
  declineErrand: (bookingId?: string) => void;
  isOfferDeclined: (bookingId: string) => boolean;
  updateErrandStatus: (status: BookingStatus) => void;
  setRunnerProfile: (profile: RunnerProfile | null) => void;
  setEarnings: (earnings: Earnings) => void;
}

export const useRunnerStore = create<RunnerState>((set, get) => ({
  isOnline: false,
  currentErrand: null,
  incomingRequest: null,
  earnings: { today: 0, week: 0, month: 0, total: 0 },
  runnerProfile: null,
  declinedOfferIds: [],

  toggleOnline: (status) => set({ isOnline: status }),

  setIncomingRequest: (request) => set({ incomingRequest: request }),

  clearIncomingRequest: () => set({ incomingRequest: null }),

  acceptErrand: (booking) =>
    // Force status forward to 'accepted' on accept. The booking object
    // passed in usually came from the IncomingRequestModal where it was
    // still 'matched' — storing it as-is would leave the runner on the
    // errand screen with NO action button (statusActions has no entry
    // for 'matched'). Server-side accept always flips to 'accepted', so
    // mirror that optimistically. The next /runner/errand/current poll
    // (or status push) will reconcile if the server returned something
    // unexpected.
    set({
      currentErrand: { ...booking, status: 'accepted' as BookingStatus },
      incomingRequest: null,
    }),

  declineErrand: (bookingId) =>
    set((state) => {
      if (!bookingId || state.declinedOfferIds.includes(bookingId)) {
        return { incomingRequest: null };
      }
      return {
        incomingRequest: null,
        declinedOfferIds: [...state.declinedOfferIds, bookingId].slice(
          -MAX_DECLINED_OFFERS,
        ),
      };
    }),

  isOfferDeclined: (bookingId) => get().declinedOfferIds.includes(bookingId),

  updateErrandStatus: (status) => {
    const current = get().currentErrand;
    if (current) {
      if (status === 'completed' || status === 'cancelled') {
        set({ currentErrand: null });
      } else {
        set({ currentErrand: { ...current, status } });
      }
    }
  },

  setRunnerProfile: (profile) => set({ runnerProfile: profile }),

  setEarnings: (earnings) => set({ earnings }),
}));
