/**
 * The proof photo must outlive the upload that failed.
 *
 * The defect: the compressed capture lived only in component state, so a
 * failure (or an app kill mid-upload) reopened an EMPTY camera and the runner
 * re-shot a doorstep they may already have left.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingProof,
  readPendingProof,
  savePendingProof,
} from '../pendingProof';

const STORAGE_KEY = '@pending_proof_v1';

// expo-file-system is a native module; the util requires it defensively. Drive
// both arms: present (URI hardened into documentDirectory) and absent.
const mockCopy = jest.fn();
const mockGetInfo = jest.fn();
const mockDelete = jest.fn();
jest.mock(
  'expo-file-system/legacy',
  () => ({
    documentDirectory: 'file:///docs/',
    copyAsync: (o: unknown) => mockCopy(o),
    getInfoAsync: (u: string) => mockGetInfo(u),
    deleteAsync: (u: string, o?: unknown) => mockDelete(u, o),
  }),
  { virtual: true },
);

const record = {
  bookingId: 'bk-1',
  phase: 'delivery' as const,
  uri: 'file:///cache/IMG_0001.jpg',
  capturedAt: '2026-09-02T08:12:00.000Z',
  status: 'delivered',
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockCopy.mockResolvedValue(undefined);
  mockGetInfo.mockResolvedValue({ exists: true });
  mockDelete.mockResolvedValue(undefined);
  await AsyncStorage.clear();
});

describe('savePendingProof', () => {
  it('copies the capture out of the cache dir so the OS cannot reclaim it', async () => {
    const stored = await savePendingProof(record);
    expect(mockCopy).toHaveBeenCalledWith({
      from: 'file:///cache/IMG_0001.jpg',
      to: 'file:///docs/proof-bk-1-delivery.jpg',
    });
    expect(stored.uri).toBe('file:///docs/proof-bk-1-delivery.jpg');
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw as string)).toMatchObject({
      bookingId: 'bk-1',
      phase: 'delivery',
      status: 'delivered',
      uri: 'file:///docs/proof-bk-1-delivery.jpg',
    });
  });

  it('keeps the original URI when the copy fails — a hiccup must not cost the proof', async () => {
    mockCopy.mockRejectedValue(new Error('no space'));
    const stored = await savePendingProof(record);
    expect(stored.uri).toBe('file:///cache/IMG_0001.jpg');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toContain('IMG_0001.jpg');
  });

  it('does not copy a file onto itself on a retry of the already-hardened URI', async () => {
    await savePendingProof({ ...record, uri: 'file:///docs/proof-bk-1-delivery.jpg' });
    expect(mockCopy).not.toHaveBeenCalled();
  });
});

describe('readPendingProof', () => {
  it('returns the record for the errand on screen', async () => {
    await savePendingProof(record);
    const got = await readPendingProof('bk-1');
    expect(got).toMatchObject({ bookingId: 'bk-1', status: 'delivered' });
  });

  it('never hands another errand’s proof to this screen', async () => {
    await savePendingProof(record);
    expect(await readPendingProof('bk-2')).toBeNull();
  });

  it('drops a record whose file has vanished rather than offering a dead resume', async () => {
    await savePendingProof(record);
    mockGetInfo.mockResolvedValue({ exists: false });
    expect(await readPendingProof('bk-1')).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('survives a corrupt payload', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'not json');
    await expect(readPendingProof('bk-1')).resolves.toBeNull();
  });
});

describe('clearPendingProof', () => {
  it('clears on server confirmation', async () => {
    await savePendingProof(record);
    await clearPendingProof('bk-1');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('refuses to clear a DIFFERENT errand’s record', async () => {
    await savePendingProof(record);
    await clearPendingProof('bk-other');
    expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});
