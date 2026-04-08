const PH_PHONE_REGEX = /^(\+63|0)9\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidPhoneNumber(phone: string): boolean {
  return PH_PHONE_REGEX.test(phone.replace(/\s/g, ''));
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function validatePasswordStrength(password: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Must contain an uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Must contain a lowercase letter');
  }
  if (!/\d/.test(password)) {
    errors.push('Must contain a number');
  }

  return { isValid: errors.length === 0, errors };
}

export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('63')) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('0')) {
    return `+63${cleaned.slice(1)}`;
  }
  return `+63${cleaned}`;
}
