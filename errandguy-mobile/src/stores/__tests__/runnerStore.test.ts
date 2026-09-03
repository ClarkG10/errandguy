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
    declinedOfferIds: [],
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
      // The store flips status to 'accepted' on accept so the home
      // dashboard reflects the new state immediately without waiting
      // on the server round-trip.
      expect(state.currentErrand).toEqual({ ...booking, status: 'accepted' });
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

    /**
     * The offer modal lives on the runner LAYOUT while the REST reconcile that
     * can re-raise a still-`matched` booking runs on Home. Two surfaces, one
     * decision — so the decline has to be remembered in the store, or a
     * fire-and-forget POST that failed gets the runner asked again 30s later.
     */
    it('remembers the declined offer id so it is never re-raised', () => {
      const booking = makeBooking({ id: 'bk-declined' });
      act(() =>
        useRunnerStore.getState().setIncomingRequest({
          booking,
          expiresAt: Date.now() + 30000,
        }),
      );
      act(() => useRunnerStore.getState().declineErrand('bk-declined'));

      expect(useRunnerStore.getState().isOfferDeclined('bk-declined')).toBe(true);
      expect(useRunnerStore.getState().isOfferDeclined('bk-other')).toBe(false);
    });

    it('does not duplicate an id declined twice', () => {
      act(() => useRunnerStore.getState().declineErrand('bk-1'));
      act(() => useRunnerStore.getState().declineErrand('bk-1'));

      expect(useRunnerStore.getState().declinedOfferIds).toEqual(['bk-1']);
    });

    it('caps the memory so it cannot grow for the life of the process', () => {
      act(() => {
        for (let i = 0; i < 60; i++) {
          useRunnerStore.getState().declineErrand(`bk-${i}`);
        }
      });

      const ids = useRunnerStore.getState().declinedOfferIds;
      expect(ids).toHaveLength(50);
      // Newest kept, oldest dropped.
      expect(ids[ids.length - 1]).toBe('bk-59');
      expect(useRunnerStore.getState().isOfferDeclined('bk-0')).toBe(false);
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
