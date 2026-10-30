/**
 * Pure pieces of the support composer, kept out of the route file so they can
 * be tested without mounting the screen.
 */

// Category chips offered in the composer. `key` is sent verbatim as the
// ticket's `category` (free string server-side, max 50).
export const SUPPORT_CATEGORIES: { key: string; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'booking', label: 'A booking' },
  { key: 'payment', label: 'Payments' },
  { key: 'account', label: 'My account' },
  { key: 'safety', label: 'Safety' },
  { key: 'other', label: 'Other' },
];

/** The errand a new ticket is opened about ("Report a problem" on an errand). */
export interface LinkedErrand {
  id: string;
  number: string | null;
}

/**
 * Turn the "Report a problem" deep link into a composer prefill. Returns null
 * when the screen was opened plainly (Help → Chat with support). The category
 * is held to the chips the composer offers so a stray param can't file a
 * ticket nobody triages.
 */
export function composePrefillFromParams(params: {
  compose?: string | string[];
  category?: string | string[];
  booking_id?: string | string[];
  booking_number?: string | string[];
}): { category: string; subject: string; errand: LinkedErrand | null } | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const bookingId = one(params.booking_id);
  if (one(params.compose) !== '1' && !bookingId) return null;
  const number = one(params.booking_number) ?? null;
  const asked = one(params.category);
  const category = SUPPORT_CATEGORIES.some((c) => c.key === asked) ? (asked as string) : bookingId ? 'booking' : 'general';
  const ref = number ?? 'my errand';
  const subject = !bookingId
    ? ''
    : category === 'safety'
      ? `Safety concern — ${ref}`
      : `Problem with ${number ? `errand ${number}` : 'my errand'}`;
  return { category, subject, errand: bookingId ? { id: bookingId, number } : null };
}
