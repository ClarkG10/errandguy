import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PASSWORD_REQUIREMENTS,
  confirmPasswordRules,
  newPasswordError,
  newPasswordRules,
} from '../passwordPolicy';

describe('new-password policy (sign-up, reset, change password)', () => {
  it.each([
    ['', 'Password is required'],
    ['Ab1!', 'Minimum 8 characters'],
    ['abcdefg1!', 'Must contain an uppercase letter'],
    ['ABCDEFG1!', 'Must contain a lowercase letter'],
    ['Abcdefgh!', 'Must contain a number'],
    ['Abcdefg12', 'Must contain a special character'],
  ])('%p → %p', (value, message) => {
    expect(newPasswordError(value)).toBe(message);
    expect(newPasswordRules.validate(value)).toBe(message);
  });

  it('accepts a password meeting every rule', () => {
    expect(newPasswordError('Errand#2026')).toBeNull();
    expect(newPasswordRules.validate('Errand#2026')).toBe(true);
    expect(PASSWORD_REQUIREMENTS.every((r) => r.test('Errand#2026'))).toBe(true);
  });

  it('confirmation must match the new password', () => {
    const rules = confirmPasswordRules(() => 'Errand#2026');
    expect(rules.validate('Errand#2026')).toBe(true);
    expect(rules.validate('Errand#2025')).toBe('Passwords do not match');
  });

  it('is the ONE copy: every new-password form and the strength checklist use it', () => {
    const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');
    for (const file of [
      'app/(auth)/register.tsx',
      'app/(auth)/reset-password.tsx',
      'components/settings/ChangePasswordSheet.tsx',
    ]) {
      const src = read(file);
      expect(src).toMatch(/rules=\{newPasswordRules\}/);
      expect(src).toMatch(/confirmPasswordRules\(/);
      expect(src).toMatch(/<PasswordStrengthIndicator /);
      // No private copy of the rules left behind.
      expect(src).not.toMatch(/\[!@#\$%\^&\*/);
    }
    expect(read('components/auth/PasswordStrengthIndicator.tsx')).toMatch(/PASSWORD_REQUIREMENTS/);
  });
});
