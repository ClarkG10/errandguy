import * as Crypto from 'expo-crypto';

export async function generatePin(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(2);
  const num = ((bytes[0] << 8) | bytes[1]) % 10000;
  return String(num).padStart(4, '0');
}
