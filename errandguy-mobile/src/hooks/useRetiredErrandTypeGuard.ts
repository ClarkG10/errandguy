import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useBookingStore } from '../stores/bookingStore';
import { isRetiredErrandSlug } from '../constants/errandTypeRules';
import { toast } from '../stores/toastStore';

/**
 * Sends a booking draft for a retired errand type back to the type picker.
 *
 * Every path that rebuilds a draft from an older booking ("Repeat last",
 * "Book again", the no-runner rebook) or restores one an older build saved can
 * name a type the server no longer offers — a food run, a ride, a bill
 * payment — and POST /bookings would refuse it at the very last tap. The rest
 * of the draft is still the customer's work, so it is left alone: the picker
 * already drops a selection that isn't in the live catalogue, and choosing a
 * new type there runs its usual type-change cleanup (addresses and contacts
 * kept, type-specific fields cleared).
 *
 * Mounted by every booking step after the picker. Returns whether the
 * redirect is happening.
 */
export function useRetiredErrandTypeGuard(): boolean {
  const router = useRouter();
  const slug = useBookingStore((s) => s.draftBooking.errand_type_slug);
  const setStep = useBookingStore((s) => s.setStep);
  const retired = isRetiredErrandSlug(slug);

  useEffect(() => {
    if (!retired) return;
    setStep(0);
    toast.info('We’ve simplified our services — choose an errand type to continue. Your addresses are kept.');
    router.replace('/(customer)/book/type');
  }, [retired, setStep, router]);

  return retired;
}
