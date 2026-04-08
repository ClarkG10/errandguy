import { act } from '@testing-library/react-native';
import { useRunnerStore } from '../runnerStore';
import { makeBooking, makeRunnerProfile } from '../../__mocks__/factories';

beforeEach(() => {
  useRunnerStore.setState({
    isOnline: false,
    currentErrand: null,
    incomingRequest: null,
    earnings: { today: 0, week: 0, month: 0, total: 0 },
    runnerProfile: null,
  });
});

describe('runnerStore', () => {
  describe('toggleOnline', () => {
    it('sets isOnline to true', () => {
      act(() => useRunnerStore.getState().toggleOnline(true));
      expect(useRunnerStore.getState().isOnline).toBe(true);
    });

    it('sets isOnline to false', () => {
      act(() => useRunnerStore.getState().toggleOnline(true));
      act(() => useRunnerStore.getState().toggleOnline(false));
      expect(useRunnerStore.getState().isOnline).toBe(false);
    });
  });

  describe('incoming request', () => {
    it('setIncomingRequest stores the request', () => {
      const request = { booking: makeBooking(), expiresAt: Date.now() + 30000 };
      act(() => useRunnerStore.getState().setIncomingRequest(request));
      expect(useRunnerStore.getState().incomingRequest).toEqual(request);
    });

    it('clearIncomingRequest removes the request', () => {
      const request = { booking: makeBooking(), expiresAt: Date.now() + 30000 };
      act(() => useRunnerStore.getState().setIncomingRequest(request));
      act(() => useRunnerStore.getState().clearIncomingRequest());
      expect(useRunnerStore.getState().incomingRequest).toBeNull();
    });
  });

  describe('acceptErrand', () => {
    it('sets currentErrand and clears incomingRequest', () => {
      const booking = makeBooking();
      const request = { booking, expiresAt: Date.now() + 30000 };
      act(() => useRunnerStore.getState().setIncomingRequest(request));
      act(() => useRunnerStore.getState().acceptErrand(booking));

      const state = useRunnerStore.getState();
      expect(state.currentErrand).toEqual(booking);
      expect(state.incomingRequest).toBeNull();
    });
  });

  describe('declineErrand', () => {
    it('clears incomingRequest without setting current errand', () => {
      const request = { booking: makeBooking(), expiresAt: Date.now() + 30000 };
      act(() => useRunnerStore.getState().setIncomingRequest(request));
      act(() => useRunnerStore.getState().declineErrand());

      const state = useRunnerStore.getState();
      expect(state.incomingRequest).toBeNull();
      expect(state.currentErrand).toBeNull();
    });
  });

  describe('updateErrandStatus', () => {
    it('updates status of current errand', () => {
      act(() => useRunnerStore.getState().acceptErrand(makeBooking({ status: 'accepted' })));
      act(() => useRunnerStore.getState().updateErrandStatus('heading_to_pickup'));

      expect(useRunnerStore.getState().currentErrand?.status).toBe('heading_to_pickup');
    });

    it('clears currentErrand when status is completed', () => {
      act(() => useRunnerStore.getState().acceptErrand(makeBooking()));
      act(() => useRunnerStore.getState().updateErrandStatus('completed'));

      expect(useRunnerStore.getState().currentErrand).toBeNull();
    });

    it('clears currentErrand when status is cancelled', () => {
      act(() => useRunnerStore.getState().acceptErrand(makeBooking()));
      act(() => useRunnerStore.getState().updateErrandStatus('cancelled'));

      expect(useRunnerStore.getState().currentErrand).toBeNull();
    });

    it('does nothing when no current errand', () => {
      act(() => useRunnerStore.getState().updateErrandStatus('accepted'));
      expect(useRunnerStore.getState().currentErrand).toBeNull();
    });
  });

  describe('setRunnerProfile', () => {
    it('stores runner profile', () => {
      const profile = makeRunnerProfile();
      act(() => useRunnerStore.getState().setRunnerProfile(profile));
      expect(useRunnerStore.getState().runnerProfile).toEqual(profile);
    });

    it('clears runner profile when null', () => {
      act(() => useRunnerStore.getState().setRunnerProfile(makeRunnerProfile()));
      act(() => useRunnerStore.getState().setRunnerProfile(null));
      expect(useRunnerStore.getState().runnerProfile).toBeNull();
    });
  });

  describe('setEarnings', () => {
    it('updates earnings data', () => {
      const earnings = { today: 500, week: 2500, month: 10000, total: 50000 };
      act(() => useRunnerStore.getState().setEarnings(earnings));
      expect(useRunnerStore.getState().earnings).toEqual(earnings);
    });
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useRunnerStore.getState();
      expect(state.isOnline).toBe(false);
      expect(state.currentErrand).toBeNull();
      expect(state.incomingRequest).toBeNull();
      expect(state.earnings).toEqual({ today: 0, week: 0, month: 0, total: 0 });
      expect(state.runnerProfile).toBeNull();
    });
  });
});
