import { renderHook } from '@testing-library/react-native';
import { useRetiredErrandTypeGuard } from '../useRetiredErrandTypeGuard';
import { useBookingStore } from '../../stores/bookingStore';
import { toast } from '../../stores/toastStore';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

/**
 * "Repeat last", "Book again" and the no-runner rebook all rebuild a draft
 * from an older booking, and a phone can restore a draft an older build saved.
 * Any of those can name a type the server retired at launch, and POST
 * /bookings would refuse it on the final tap — so every booking step after
 * the picker sends such a draft back to choose a current type.
 */
const start = (draft: Record<string, unknown>, step = 3) =>
  useBookingStore.setState({ draftBooking: draft, currentStep: step });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(toast, 'info').mockImplementation(() => undefined as never);
});

describe('useRetiredErrandTypeGuard', () => {
  it.each(['food', 'grocery', 'document', 'laundry', 'transportation', 'bills_payment'])(
    'sends a %s draft back to the type picker, keeping the rest of it',
    (slug) => {
      start({ errand_type_id: `${slug}-id`, errand_type_slug: slug, pickup_address: 'A' });
      const { result } = renderHook(() => useRetiredErrandTypeGuard());

      expect(result.current).toBe(true);
      expect(mockReplace).toHaveBeenCalledWith('/(customer)/book/type');
      expect(toast.info).toHaveBeenCalledTimes(1);
      const s = useBookingStore.getState();
      expect(s.currentStep).toBe(0);
      expect(s.draftBooking.pickup_address).toBe('A');
    },
  );

  it.each(['delivery', 'purchase', 'queue', 'custom'])('leaves a %s draft alone', (slug) => {
    start({ errand_type_id: `${slug}-id`, errand_type_slug: slug });
    const { result } = renderHook(() => useRetiredErrandTypeGuard());

    expect(result.current).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(useBookingStore.getState().currentStep).toBe(3);
  });
});
