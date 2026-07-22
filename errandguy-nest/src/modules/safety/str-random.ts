import { randomBytes } from 'crypto';

/**
 * Faithful port of Laravel's `Str::random($length)`. Generates a
 * cryptographically-random alphanumeric string of exactly `$length` chars by
 * base64-encoding random bytes and stripping the non-alphanumeric `+`, `/`, `=`.
 */
export function strRandom(length = 64): string {
  let str = '';
  while (str.length < length) {
    const size = length - str.length;
    const bytesSize = Math.ceil(size / 3) * 3;
    const bytes = randomBytes(bytesSize);
    str += bytes.toString('base64').replace(/[/+=]/g, '').slice(0, size);
  }
  return str;
}
