import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

/**
 * Map a server 422 error payload (`{ errors: { field: [msg] } }`) onto
 * react-hook-form fields. Generalizes the identical loop that was hand-rolled
 * in login/register/forgot-password.
 *
 * @param err     The normalized rejection from `api.ts` (carries `errors`).
 * @param setError react-hook-form's `setError`.
 * @param alias   Map a server field name to a different form field, e.g.
 *                `{ phone: 'identifier', email: 'identifier' }` when the login
 *                form has one combined field.
 * @returns true if at least one field error was applied. Returns false when
 *          nothing mapped, so the caller can fall back to a toast for
 *          global/unmapped errors (preserving login's existing behavior).
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  alias: Partial<Record<string, Path<T>>> = {},
): boolean {
  const errors = (err as { errors?: Record<string, string[] | string> } | null)?.errors;
  if (!errors || typeof errors !== 'object') return false;

  let applied = false;
  for (const [field, messages] of Object.entries(errors)) {
    const message = Array.isArray(messages) ? messages[0] : messages;
    if (!message) continue;
    const target = (alias[field] ?? field) as Path<T>;
    setError(target, { type: 'server', message });
    applied = true;
  }

  return applied;
}
