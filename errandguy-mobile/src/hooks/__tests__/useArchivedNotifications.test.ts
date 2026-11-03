import { renderHook, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useArchivedNotifications } from '../useArchivedNotifications';
import type { AppNotification } from '../../types';

/**
 * Archiving a notification used to hide it for good — no list to find it in.
 * The archive is its own list (GET /notifications?archived=1), fetched only
 * while it's open, and kept out of the inbox store the badge counts.
 */

const mockGet = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
}));

const row = (id: string, is_read = false): AppNotification => ({
  id,
  user_id: 'u1',
  title: `Title ${id}`,
  body: 'Body',
  type: 'booking_update',
  data: null,
  is_read,
  created_at: '2026-11-01T10:00:00Z',
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('useArchivedNotifications', () => {
  it('asks for the archived set only, and only while open', async () => {
    mockGet.mockResolvedValue({ data: { data: [row('a')], meta: { last_page: 1 } } });

    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useArchivedNotifications('u1', open),
      { initialProps: { open: false } },
    );
    await act(async () => {});
    expect(mockGet).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(mockGet).toHaveBeenCalledWith('/notifications', {
      params: { archived: 1, page: 1, per_page: 20 },
      silent: true,
    });
    expect(result.current.hasMore).toBe(false);
  });

  it('pages on, without repeating a row', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { data: [row('a'), row('b')], meta: { last_page: 2 } } })
      .mockResolvedValueOnce({ data: { data: [row('b'), row('c')], meta: { last_page: 2 } } });

    const { result } = renderHook(() => useArchivedNotifications('u1', true));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.rows.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);
    expect(mockGet).toHaveBeenLastCalledWith('/notifications', {
      params: { archived: 1, page: 2, per_page: 20 },
      silent: true,
    });
  });

  it('takes a row out for "move to inbox" and can put it back where it was', async () => {
    mockGet.mockResolvedValue({ data: { data: [row('a'), row('b'), row('c')], meta: { last_page: 1 } } });
    const { result } = renderHook(() => useArchivedNotifications('u1', true));
    await waitFor(() => expect(result.current.rows).toHaveLength(3));

    let index = -1;
    act(() => {
      index = result.current.removeRow('b');
    });
    expect(index).toBe(1);
    expect(result.current.rows.map((n) => n.id)).toEqual(['a', 'c']);

    act(() => {
      result.current.restoreRow(row('b'), index);
    });
    expect(result.current.rows.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('marks an opened archived row read locally', async () => {
    mockGet.mockResolvedValue({ data: { data: [row('a')], meta: { last_page: 1 } } });
    const { result } = renderHook(() => useArchivedNotifications('u1', true));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    act(() => {
      result.current.markReadLocal('a');
    });
    expect(result.current.rows[0].is_read).toBe(true);
  });
});
