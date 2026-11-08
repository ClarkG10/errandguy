/**
 * Pattern 9 (form validation) for the sign-in screens: each check returns the
 * exact fix for the field ("Add a domain, like name@gmail.com"), or null when
 * the value passes. Screens show the message inline under the field and use
 * the same checks to keep the CTA disabled until the form is valid.
 *
 * The rules themselves are the shared ones — `isPhMobile` (utils/phone) and
 * PASSWORD_REQUIREMENTS (utils/validation/passwordPolicy) — so a value these
 * accept is one the server accepts. Only the wording lives here.
 */
import { isPhMobile } from '../../utils/phone';
import { PASSWORD_REQUIREMENTS, newPasswordError } from '../../utils/validation/passwordPolicy';

const EXAMPLE_PHONE = '0917 123 4567';

/** Problems with an email address, phrased as the fix. */
export function emailProblem(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return 'Enter your email address';
  if (/\s/.test(v)) return 'Remove the spaces from your email';
  const at = v.indexOf('@');
  if (at === -1) return 'Add an @, like name@gmail.com';
  if (v.indexOf('@', at + 1) !== -1) return 'Use only one @ in your email';
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!local) return 'Add your name before the @, like name@gmail.com';
  if (!domain) return 'Add a domain after the @, like name@gmail.com';
  // "name@gmail" → suggest the ending on the domain they actually typed.
  if (!domain.includes('.')) return `Add a domain, like name@${domain}.com`;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return 'Check the part after the @, like name@gmail.com';
  }
  return null;
}

/** Problems with a PH mobile number, phrased as the fix. */
export function phoneProblem(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return 'Enter your mobile number';
  if (isPhMobile(v)) return null;
  if (/[^\d\s\-().+]/.test(v)) return `Use numbers only, like ${EXAMPLE_PHONE}`;
  const digits = v.replace(/\D/g, '');
  if (/^\+?63/.test(v.replace(/[\s\-().]/g, ''))) {
    // +63 9XX XXX XXXX — 12 digits counting the 63.
    return `Use +63 and 10 digits, like +63 917 123 4567`;
  }
  if (digits.startsWith('0') && !digits.startsWith('09')) {
    return `Mobile numbers start with 09, like ${EXAMPLE_PHONE}`;
  }
  if (digits.startsWith('09')) {
    if (digits.length < 11) {
      const short = 11 - digits.length;
      return `Add ${short} more digit${short === 1 ? '' : 's'} — use 11, like ${EXAMPLE_PHONE}`;
    }
    return `That's too many digits — use 11, like ${EXAMPLE_PHONE}`;
  }
  return `Use 11 digits, like ${EXAMPLE_PHONE}`;
}

/** Sign-in identifier: a PH mobile number or an email. */
export function identifierProblem(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return 'Enter your phone number or email';
  // Anything with an @ or a letter is meant as an email; digits are a phone.
  if (v.includes('@') || /[a-z]/i.test(v)) return emailProblem(v);
  return phoneProblem(v);
}

/** The password on the sign-in form (any password the account has). */
export function signInPasswordProblem(raw: string | null | undefined): string | null {
  const v = raw ?? '';
  if (!v) return 'Enter your password';
  if (v.length < 8) return 'Passwords here are at least 8 characters — check what you typed';
  return null;
}

const REQUIREMENT_FIX: Record<string, (v: string) => string> = {
  'At least 8 characters': (v) => {
    const more = 8 - v.length;
    return `Use at least 8 characters — ${more} more to go`;
  },
  'Uppercase letter': () => 'Add an uppercase letter (A–Z)',
  'Lowercase letter': () => 'Add a lowercase letter (a–z)',
  Number: () => 'Add a number (0–9)',
  'Special character': () => 'Add a symbol, like ! # or _',
};

/** A NEW password (sign-up, reset): the first rule it misses, as the fix. */
export function newPasswordProblem(raw: string | null | undefined): string | null {
  const v = raw ?? '';
  if (!v) return 'Create a password';
  const missed = PASSWORD_REQUIREMENTS.find((r) => !r.test(v));
  if (!missed) return newPasswordError(v);
  return REQUIREMENT_FIX[missed.label]?.(v) ?? newPasswordError(v);
}

/** The confirmation of a new password. */
export function confirmPasswordProblem(raw: string | null | undefined, password: string): string | null {
  const v = raw ?? '';
  if (!v) return 'Type your password again';
  if (v !== password) return "Doesn't match — type the same password as above";
  return null;
}

/** Full name on sign-up. */
export function fullNameProblem(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return 'Enter your full name';
  if (v.length > 100) return 'Use 100 characters or fewer';
  if (v.length < 2) return 'Enter your full name, like Juan Dela Cruz';
  return null;
}

/** react-hook-form `validate` adapter: message or true. */
export const asRule =
  (check: (v: string) => string | null) =>
  (value: string): string | true =>
    check(value ?? '') ?? true;
