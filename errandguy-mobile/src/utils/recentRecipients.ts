import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Last-used booking recipients (pickup / drop-off contacts).
 *
 * Sending the same package to the same person every week meant retyping their
 * name and 11-digit number into the booking form each time. We remember the
 * last few on the DEVICE only — the server already stores them per booking,
 * so this is purely a typing shortcut, never a source of truth.
 *
 * Storage is scoped by user id so a second account signing in on the same
 * handset can never read the previous user's contacts, and
 * `clearRecentRecipients` takes them off the disk entirely on account
 * teardown (see clearAccountScopedState).
 */

export interface RecentRecipient {
  name: string;
  phone: string;
}

const KEY_PREFIX = '@errandguy:recent_recipients';
const RECIPIENT_CAP = 3;

function storageKey(userId?: string | null): string {
  return `${KEY_PREFIX}:${userId || 'anon'}`;
}

/**
 * Normalize a phone number to the 09XXXXXXXXX shape the booking form uses.
 * The native contact picker hands back all of "+63 917 …", "63917 …",
 * "0917-123-4567" and "917 123 4567"; the booking inputs only keep digits and
 * cap at 13 characters, so a raw paste would silently truncate.
 */
export function normalizePhPhone(raw: string): string {
  let p = (raw ?? '').replace(/[^0-9+]/g, '');
  if (p.startsWith('+63')) {
    p = `0${p.slice(3)}`;
  } else if (p.startsWith('63') && p.length >= 12) {
    p = `0${p.slice(2)}`;
  } else if (p.startsWith('9') && p.length === 10) {
    p = `0${p}`;
  }
  // Any surviving '+' (a non-PH international number) is dropped rather than
  // kept mid-string, matching the form's own digit-only sanitize.
  return p.replace(/\+/g, '').slice(0, 13);
}

/** Digits-only identity used to dedupe — "0917 123 4567" == "+639171234567". */
function phoneKey(phone: string): string {
  return normalizePhPhone(phone);
}

export async function getRecentRecipients(
  userId?: string | null,
  limit: number = RECIPIENT_CAP,
): Promise<RecentRecipient[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (x): x is RecentRecipient =>
          !!x &&
          typeof x.name === 'string' &&
          typeof x.phone === 'string' &&
          x.name.trim().length > 0 &&
          x.phone.trim().length > 0,
      )
      .map((x) => ({ name: x.name.trim(), phone: x.phone.trim() }))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Promote a recipient to the top of the list. Silently ignores half-filled
 * pairs (a name with no number is useless as a one-tap fill).
 */
export async function addRecentRecipient(
  userId: string | null | undefined,
  recipient: RecentRecipient,
): Promise<void> {
  const name = (recipient?.name ?? '').trim();
  const phone = (recipient?.phone ?? '').trim();
  if (!name || !phone) return;
  try {
    const existing = await getRecentRecipients(userId, RECIPIENT_CAP);
    const key = phoneKey(phone);
    const next = [
      { name, phone },
      ...existing.filter((r) => phoneKey(r.phone) !== key),
    ].slice(0, RECIPIENT_CAP);
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* non-critical — this is a typing shortcut, never data the booking needs */
  }
}

/**
 * Wipe EVERY account's recipients off this device (logout / account switch).
 *
 * Deliberately not user-scoped: the teardown path runs after the incoming user
 * has already been written into the auth store (setUser → reconcileAccount),
 * so the id of the account being torn down isn't knowable from there. Dropping
 * a typing shortcut too eagerly costs a few keystrokes; leaving a stranger's
 * name and mobile number on a shared handset costs a lot more.
 */
export async function clearRecentRecipients(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const recipientKeys = allKeys.filter((k) => k.startsWith(`${KEY_PREFIX}:`));
    if (recipientKeys.length > 0) {
      await AsyncStorage.multiRemove(recipientKeys);
    }
  } catch {
    /* non-critical */
  }
}
