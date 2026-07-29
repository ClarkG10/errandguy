import { z } from 'zod';

/**
 * Shared validation schemas — one source of truth for field rules, replacing
 * the inline react-hook-form `rules` objects and the manual `newErrors` maps.
 *
 * Copy here is the inline, per-field validation message (what renders under the
 * `Input`). Keep it short and specific. Server-side rejections are mapped back
 * onto the same fields via `applyServerErrors`.
 */

/** PH mobile number: 09XXXXXXXXX or +639XXXXXXXXX (matches the backend regex). */
export const phPhone = z
  .string()
  .trim()
  .regex(/^(09\d{9}|\+639\d{9})$/, 'Enter a valid PH mobile number (09XXXXXXXXX).');

export const email = z.string().trim().email('Enter a valid email address.');

export const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(100, 'Keep it under 100 characters.');

/** Login accepts either a phone or an email in one combined field. */
export const loginIdentifier = z
  .string()
  .trim()
  .min(1, 'Enter your phone number or email.');

export const loginSchema = z.object({
  identifier: loginIdentifier,
  password: z.string().min(1, 'Enter your password.'),
});
export type LoginForm = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  first_name: z.string().trim().min(1, 'Enter your first name.').max(100, 'That name is too long.'),
  last_name: z.string().trim().min(1, 'Enter your last name.').max(100, 'That name is too long.'),
  email,
  phone: phPhone,
  password,
});
export type RegisterForm = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;
