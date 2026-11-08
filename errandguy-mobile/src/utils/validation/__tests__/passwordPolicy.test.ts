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

  /**
   * The server's symbols() rule is Laravel's `/\p{Z}|\p{S}|\p{P}/u`: any
   * space, symbol or punctuation. The form used to accept only a short
   * hand-picked list, so it refused passwords the server takes.
   */
  it.each(['Juan_2024A', 'Errand-2026a', 'Errand+2026a', 'Errand~2026a', 'Errand 2026a', 'Bayad₱2026a', 'Errand/2026a'])(
    'counts %p as having a special character, like the server',
    (value) => {
      expect(newPasswordError(value)).toBeNull();
      expect(PASSWORD_REQUIREMENTS.find((r) => r.label === 'Special character')?.test(value)).toBe(true);
    },
  );

  it.each(['Juan2024Ab', 'Juañ2024Ab'])('still asks for one in %p — letters and digits only', (value) => {
    expect(newPasswordError(value)).toBe('Must contain a special character');
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
      // The sign-in screens word each miss as its fix (components/auth/
      // fieldRules), but the rules themselves still come from here.
      expect(src).toMatch(/rules=\{newPasswordRules\}|asRule\(newPasswordProblem\)/);
      expect(src).toMatch(/confirmPasswordRules\(|confirmPasswordProblem\(/);
      expect(src).toMatch(/<PasswordStrengthIndicator /);
      // No private copy of the rules left behind.
      expect(src).not.toMatch(/\[!@#\$%\^&\*/);
    }
    expect(read('components/auth/PasswordStrengthIndicator.tsx')).toMatch(/PASSWORD_REQUIREMENTS/);
    // The how-to-fix wording derives from the same list — no second copy.
    const fieldRules = read('components/auth/fieldRules.ts');
    expect(fieldRules).toMatch(/PASSWORD_REQUIREMENTS\.find/);
    expect(fieldRules).not.toMatch(/\[!@#\$%\^&\*/);
  });
});
