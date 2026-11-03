/**
 * The rules a NEW password must meet — one copy, shared by sign-up, the
 * forgot-password reset and Change password, so the three can never drift.
 *
 * Mirrors the server (RegisterRequest / ResetPasswordRequest:
 * Password::min(8)->mixedCase()->numbers()->symbols()), so a password the form
 * accepts is one the server accepts. `PasswordStrengthIndicator` renders the
 * same list as its live checklist.
 */

/**
 * What counts as a special character: exactly Laravel's `symbols()` test
 * (Illuminate\Validation\Rules\Password: `/\p{Z}|\p{S}|\p{P}/u`) — any
 * space, symbol or punctuation mark, `_`, `-`, `+`, `~` and `₱` included. The
 * old hand-picked list refused passwords the server accepts, like "Juan_2024A".
 */
const SPECIAL_CHARACTER = /\p{Z}|\p{S}|\p{P}/u;

export const PASSWORD_REQUIREMENTS: readonly { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'Uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'Number', test: (p) => /\d/.test(p) },
  { label: 'Special character', test: (p) => SPECIAL_CHARACTER.test(p) },
];

/** The inline error for a new password, or null when it meets every rule. */
export function newPasswordError(value: string): string | null {
  if (!value) return 'Password is required';
  if (value.length < 8) return 'Minimum 8 characters';
  if (!/[A-Z]/.test(value)) return 'Must contain an uppercase letter';
  if (!/[a-z]/.test(value)) return 'Must contain a lowercase letter';
  if (!/\d/.test(value)) return 'Must contain a number';
  if (!SPECIAL_CHARACTER.test(value)) return 'Must contain a special character';
  return null;
}

/** react-hook-form `rules` for a new-password field. */
export const newPasswordRules = {
  validate: (value: string) => newPasswordError(value ?? '') ?? true,
};

/** react-hook-form `rules` for its confirmation field. */
export function confirmPasswordRules(getPassword: () => string) {
  return {
    required: 'Please confirm your password',
    validate: (value: string) => value === getPassword() || 'Passwords do not match',
  };
}
