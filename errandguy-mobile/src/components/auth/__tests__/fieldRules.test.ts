import {
  confirmPasswordProblem,
  emailProblem,
  fullNameProblem,
  identifierProblem,
  newPasswordProblem,
  phoneProblem,
  signInPasswordProblem,
} from '../fieldRules';
import { newPasswordError } from '../../../utils/validation/passwordPolicy';

/**
 * Pattern 9: every field error says how to fix it, not just that it's wrong.
 * The checks agree with the shared rules (isPhMobile, PASSWORD_REQUIREMENTS),
 * so a value these accept is one the server accepts.
 */
describe('email', () => {
  it.each([
    ['', 'Enter your email address'],
    ['juan', 'Add an @, like name@gmail.com'],
    ['juan@', 'Add a domain after the @, like name@gmail.com'],
    ['@gmail.com', 'Add your name before the @, like name@gmail.com'],
    ['pradeep@strategyfox', 'Add a domain, like name@strategyfox.com'],
    ['juan@@gmail.com', 'Use only one @ in your email'],
    ['juan dc@gmail.com', 'Remove the spaces from your email'],
    ['juan@gmail..com', 'Check the part after the @, like name@gmail.com'],
  ])('%p → %p', (value, message) => {
    expect(emailProblem(value)).toBe(message);
  });

  it.each(['juan@gmail.com', '  ana.cruz@company.co.ph ', '09171234567@gmail.com'])('accepts %p', (value) => {
    expect(emailProblem(value)).toBeNull();
  });
});

describe('PH mobile number', () => {
  it.each(['09171234567', '0917 123 4567', '+63 917 123 4567', '639171234567', '9171234567'])(
    'accepts %p',
    (value) => {
      expect(phoneProblem(value)).toBeNull();
    },
  );

  it('counts the missing digits', () => {
    expect(phoneProblem('0917123')).toBe('Add 4 more digits — use 11, like 0917 123 4567');
    expect(phoneProblem('0917123456')).toBe('Add 1 more digit — use 11, like 0917 123 4567');
  });

  it('says when there are too many, or the wrong start', () => {
    expect(phoneProblem('091712345678')).toBe("That's too many digits — use 11, like 0917 123 4567");
    expect(phoneProblem('0817 123 4567')).toBe('Mobile numbers start with 09, like 0917 123 4567');
    expect(phoneProblem('0917abc')).toBe('Use numbers only, like 0917 123 4567');
    expect(phoneProblem('')).toBe('Enter your mobile number');
  });
});

describe('sign-in identifier', () => {
  it('routes letters and @ to the email check, digits to the phone check', () => {
    expect(identifierProblem('dalauta@gmail')).toBe('Add a domain, like name@gmail.com');
    expect(identifierProblem('0917123')).toBe('Add 4 more digits — use 11, like 0917 123 4567');
    expect(identifierProblem('09180000200')).toBeNull();
    expect(identifierProblem('ana@example.com')).toBeNull();
    expect(identifierProblem(' ')).toBe('Enter your phone number or email');
  });

  it('asks for a password on sign-in without restating the new-password rules', () => {
    expect(signInPasswordProblem('')).toBe('Enter your password');
    expect(signInPasswordProblem('short')).toMatch(/at least 8 characters/);
    expect(signInPasswordProblem('anything8')).toBeNull();
  });
});

describe('new password', () => {
  it('names the first missing rule as its fix', () => {
    expect(newPasswordProblem('')).toBe('Create a password');
    expect(newPasswordProblem('Ab1!')).toBe('Use at least 8 characters — 4 more to go');
    expect(newPasswordProblem('weakpass')).toBe('Add an uppercase letter (A–Z)');
    expect(newPasswordProblem('WEAKPASS1!')).toBe('Add a lowercase letter (a–z)');
    expect(newPasswordProblem('Weakpass!')).toBe('Add a number (0–9)');
    expect(newPasswordProblem('Weakpass1')).toBe('Add a symbol, like ! # or _');
  });

  it('accepts exactly what the shared policy accepts', () => {
    for (const value of ['Errand#2026', 'Juan_2024A', 'Juan 2024a', 'weakpass', 'Weakpass1']) {
      expect(newPasswordProblem(value) === null).toBe(newPasswordError(value) === null);
    }
  });

  it('checks the confirmation against the password', () => {
    expect(confirmPasswordProblem('', 'Errand#2026')).toBe('Type your password again');
    expect(confirmPasswordProblem('Errand#202', 'Errand#2026')).toBe(
      "Doesn't match — type the same password as above",
    );
    expect(confirmPasswordProblem('Errand#2026', 'Errand#2026')).toBeNull();
  });
});

describe('full name', () => {
  it('asks for a real name', () => {
    expect(fullNameProblem('')).toBe('Enter your full name');
    expect(fullNameProblem('J')).toBe('Enter your full name, like Juan Dela Cruz');
    expect(fullNameProblem('x'.repeat(101))).toBe('Use 100 characters or fewer');
    expect(fullNameProblem('Maria Santos')).toBeNull();
  });
});
