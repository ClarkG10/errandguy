import { act } from '@testing-library/react-native';
import { useBookingStore } from '../bookingStore';
import { makeBooking } from '../../__mocks__/factories';

beforeEach(() => {
  useBookingStore.setState({
    activeBooking: null,
    bookingHistory: [],
    currentStep: 0,
    draftBooking: {},
    isLoading: false,
  });
});

describe('bookingStore', () => {
  describe('setActiveBooking', () => {
    it('sets active booking', () => {
      const booking = makeBooking();
      act(() => useBookingStore.getState().setActiveBooking(booking));
      expect(useBookingStore.getState().activeBooking).toEqual(booking);
    });

    it('clears active booking when null', () => {
      act(() => useBookingStore.getState().setActiveBooking(makeBooking()));
      act(() => useBookingStore.getState().setActiveBooking(null));
      expect(useBookingStore.getState().activeBooking).toBeNull();
    });
  });

  describe('updateBookingStatus', () => {
    it('updates status of active booking', () => {
      act(() => useBookingStore.getState().setActiveBooking(makeBooking({ status: 'pending' })));
      act(() => useBookingStore.getState().updateBookingStatus('accepted'));
      expect(useBookingStore.getState().activeBooking?.status).toBe('accepted');
    });

    it('does nothing when no active booking', () => {
      act(() => useBookingStore.getState().updateBookingStatus('accepted'));
      expect(useBookingStore.getState().activeBooking).toBeNull();
    });
  });

  describe('draft management', () => {
    it('updateDraft merges data into draft', () => {
      act(() =>
        useBookingStore.getState().updateDraft({
          pickup_address: '123 Main St',
          errand_type_id: 'type-001',
        }),
      );
      const { draftBooking } = useBookingStore.getState();
      expect(draftBooking.pickup_address).toBe('123 Main St');
      expect(draftBooking.errand_type_id).toBe('type-001');
    });

    it('updateDraft does not overwrite unrelated fields', () => {
      act(() => useBookingStore.getState().updateDraft({ pickup_address: '123 Main St' }));
      act(() => useBookingStore.getState().updateDraft({ dropoff_address: '456 End Rd' }));

      const { draftBooking } = useBookingStore.getState();
      expect(draftBooking.pickup_address).toBe('123 Main St');
      expect(draftBooking.dropoff_address).toBe('456 End Rd');
    });

    it('clearDraft resets draft and step', () => {
      act(() => {
        useBookingStore.getState().updateDraft({ pickup_address: '123 Main St' });
        useBookingStore.getState().setStep(3);
      });
      act(() => useBookingStore.getState().clearDraft());

      const state = useBookingStore.getState();
      expect(state.draftBooking).toEqual({});
      expect(state.currentStep).toBe(0);
    });
  });

  describe('step progression', () => {
    it('setStep updates current step', () => {
      act(() => useBookingStore.getState().setStep(2));
      expect(useBookingStore.getState().currentStep).toBe(2);
    });

    it('starts at step 0', () => {
      expect(useBookingStore.getState().currentStep).toBe(0);
    });
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useBookingStore.getState();
      expect(state.activeBooking).toBeNull();
      expect(state.bookingHistory).toEqual([]);
      expect(state.currentStep).toBe(0);
      expect(state.draftBooking).toEqual({});
      expect(state.isLoading).toBe(false);
    });
  });
});
