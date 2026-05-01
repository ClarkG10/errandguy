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

interface RunnerState {
  isOnline: boolean;
  currentErrand: Booking | null;
  incomingRequest: IncomingRequest | null;
  earnings: Earnings;
  runnerProfile: RunnerProfile | null;

  toggleOnline: (status: boolean) => void;
  setIncomingRequest: (request: IncomingRequest | null) => void;
  clearIncomingRequest: () => void;
  acceptErrand: (booking: Booking) => void;
  declineErrand: () => void;
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

  declineErrand: () => set({ incomingRequest: null }),

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
