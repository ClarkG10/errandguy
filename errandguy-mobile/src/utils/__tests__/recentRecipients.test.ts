import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addRecentRecipient,
  clearRecentRecipients,
  getRecentRecipients,
  normalizePhPhone,
} from '../recentRecipients';

const USER = 'user-1';
const KEY = '@errandguy:recent_recipients:user-1';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('normalizePhPhone', () => {
  it('normalizes every shape the contact picker returns to 09XXXXXXXXX', () => {
    expect(normalizePhPhone('+63 917 123 4567')).toBe('09171234567');
    expect(normalizePhPhone('639171234567')).toBe('09171234567');
    expect(normalizePhPhone('0917-123-4567')).toBe('09171234567');
    expect(normalizePhPhone('(0917) 123 4567')).toBe('09171234567');
    expect(normalizePhPhone('9171234567')).toBe('09171234567');
  });

  it('leaves a landline alone and never exceeds the form cap', () => {
    expect(normalizePhPhone('(02) 8888 7777')).toBe('0288887777');
    expect(normalizePhPhone('0917123456789999')).toHaveLength(13);
  });

  it('is safe on junk input', () => {
    expect(normalizePhPhone('')).toBe('');
    expect(normalizePhPhone('no digits here')).toBe('');
    // @ts-expect-error — guarding the runtime path a stale cache could hit
    expect(normalizePhPhone(undefined)).toBe('');
  });
});

describe('recent recipients', () => {
  it('returns an empty list before anything is stored', async () => {
    await expect(getRecentRecipients(USER)).resolves.toEqual([]);
  });

  it('stores the most recent first and caps the list at 3', async () => {
    await addRecentRecipient(USER, { name: 'Ana', phone: '09171111111' });
    await addRecentRecipient(USER, { name: 'Ben', phone: '09172222222' });
    await addRecentRecipient(USER, { name: 'Cara', phone: '09173333333' });
    await addRecentRecipient(USER, { name: 'Dee', phone: '09174444444' });

    const list = await getRecentRecipients(USER);
    expect(list.map((r) => r.name)).toEqual(['Dee', 'Cara', 'Ben']);
  });

  it('dedupes by number regardless of how it was typed, keeping the newest name', async () => {
    await addRecentRecipient(USER, { name: 'Ana Cruz', phone: '09171111111' });
    await addRecentRecipient(USER, { name: 'Ben', phone: '09172222222' });
    await addRecentRecipient(USER, { name: 'Ana R. Cruz', phone: '+63 917 111 1111' });

    const list = await getRecentRecipients(USER);
    expect(list).toEqual([
      { name: 'Ana R. Cruz', phone: '+63 917 111 1111' },
      { name: 'Ben', phone: '09172222222' },
    ]);
  });

  it('ignores half-filled pairs', async () => {
    await addRecentRecipient(USER, { name: 'No number', phone: '   ' });
    await addRecentRecipient(USER, { name: '', phone: '09171111111' });
    await expect(getRecentRecipients(USER)).resolves.toEqual([]);
  });

  it('scopes storage per account so a second sign-in cannot read the first', async () => {
    await addRecentRecipient(USER, { name: 'Ana', phone: '09171111111' });
    await expect(getRecentRecipients('user-2')).resolves.toEqual([]);
    await expect(getRecentRecipients(USER)).resolves.toHaveLength(1);
  });

  it('survives corrupt storage', async () => {
    await AsyncStorage.setItem(KEY, 'not json');
    await expect(getRecentRecipients(USER)).resolves.toEqual([]);

    await AsyncStorage.setItem(KEY, JSON.stringify({ nope: true }));
    await expect(getRecentRecipients(USER)).resolves.toEqual([]);

    await AsyncStorage.setItem(
      KEY,
      JSON.stringify([{ name: 'Ana', phone: '09171111111' }, null, { name: 5 }]),
    );
    await expect(getRecentRecipients(USER)).resolves.toEqual([
      { name: 'Ana', phone: '09171111111' },
    ]);
  });

  it('clears every account bucket, not just the signed-in one', async () => {
    await addRecentRecipient(USER, { name: 'Ana', phone: '09171111111' });
    await addRecentRecipient('user-2', { name: 'Ben', phone: '09172222222' });
    await addRecentRecipient(null, { name: 'Cara', phone: '09173333333' });
    await AsyncStorage.setItem('@unrelated_key', 'keep me');

    await clearRecentRecipients();

    await expect(getRecentRecipients(USER)).resolves.toEqual([]);
    await expect(getRecentRecipients('user-2')).resolves.toEqual([]);
    await expect(getRecentRecipients(null)).resolves.toEqual([]);
    await expect(AsyncStorage.getItem('@unrelated_key')).resolves.toBe('keep me');
  });
});
