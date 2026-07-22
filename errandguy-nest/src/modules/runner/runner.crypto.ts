import { createCipheriv, createHash, randomBytes } from 'crypto';

/**
 * RunnerProfile.bank_account_number is encrypted at rest in Laravel via
 * `Crypt::encryptString`. We reproduce encryption-at-rest with AES-256-CBC keyed
 * off APP_ENCRYPTION_KEY (base64). The stored value is `base64(iv || ciphertext)`
 * and is NEVER serialized back to any client (the column is hidden and no
 * endpoint reads it back), so a faithful, non-Laravel-compatible envelope is
 * acceptable — the only requirement is that the plaintext never lands in the DB.
 */
function key(): Buffer {
  const raw = (process.env.APP_ENCRYPTION_KEY ?? '').replace(/^base64:/, '');
  const decoded = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  // AES-256 needs exactly 32 bytes; derive deterministically when the supplied
  // key is not already a 32-byte base64 blob.
  return decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
}

/** Encrypt a bank account number for storage. Returns null for empty input. */
export function encryptBankAccount(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key(), iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, enc]).toString('base64');
}
