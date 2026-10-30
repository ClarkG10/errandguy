import {
  formatPhMobile,
  isPhMobile,
  phoneForApi,
  toPhMobileE164,
  toPhMobileLocal,
} from '../phone';

/**
 * Every mobile number the app sends goes out as +639XXXXXXXXX, whichever way
 * it was typed — same acceptance rule as App\Support\PhilippinePhone.
 */
describe('PH mobile normalisation', () => {
  it.each([
    ['09171234567', '+639171234567'],
    ['+639171234567', '+639171234567'],
    ['639171234567', '+639171234567'],
    ['9171234567', '+639171234567'],
    ['0917 123 4567', '+639171234567'],
    ['+63 917-123-4567', '+639171234567'],
    ['(0917) 123.4567', '+639171234567'],
    ['  09171234567  ', '+639171234567'],
  ])('%p → %p', (input, expected) => {
    expect(toPhMobileE164(input)).toBe(expected);
    expect(isPhMobile(input)).toBe(true);
  });

  it.each(['', '0917123456', '08171234567', '+63917123456', '6391712345678', '+1 415 555 0100', 'abc'])(
    'rejects %p',
    (input) => {
      expect(toPhMobileE164(input)).toBeNull();
      expect(isPhMobile(input)).toBe(false);
    },
  );

  it('rejects non-strings', () => {
    expect(toPhMobileE164(null)).toBeNull();
    expect(toPhMobileE164(undefined)).toBeNull();
  });

  it('gives the local spelling for legacy lookups and display', () => {
    expect(toPhMobileLocal('+639171234567')).toBe('09171234567');
    expect(formatPhMobile('+639171234567')).toBe('0917 123 4567');
    // Unrecognised values are shown as stored, never mangled.
    expect(formatPhMobile('12345')).toBe('12345');
    expect(formatPhMobile(null)).toBe('');
  });

  it('phoneForApi normalises a PH mobile and passes anything else through untouched', () => {
    expect(phoneForApi('0917-123-4567')).toBe('+639171234567');
    // A typo reaches the server as typed, so ITS validation explains it.
    expect(phoneForApi('0917')).toBe('0917');
    expect(phoneForApi(undefined)).toBeUndefined();
    expect(phoneForApi(null)).toBeNull();
    expect(phoneForApi('')).toBe('');
  });
});
