import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useQuery } from './useQuery';
import { CacheTTL } from '../services/cache.service';
import type { AppNotification } from '../types';

const PAGE_SIZE = 20;

interface ArchivedPage {
  list: AppNotification[];
  hasMore: boolean;
}

/**
 * GET /notifications?archived=1 — the archived set only
 * (NotificationController::index). Never micro-cached: it is read right after
 * an archive or a "move to inbox", and a cached body would undo either.
 */
async function fetchArchivedPage(page: number): Promise<ArchivedPage> {
  const r = await api.get('/notifications', {
    params: { archived: 1, page, per_page: PAGE_SIZE },
    silent: true,
  });
  const list = (r.data?.data ?? []) as AppNotification[];
  const meta = r.data?.meta ?? r.data;
  const lastPage = Number(meta?.last_page);
  return {
    list,
    hasMore: Number.isFinite(lastPage) ? page < lastPage : list.length >= PAGE_SIZE,
  };
}

/**
 * The customer's archived notifications — archiving used to hide a row for
 * good, with no list to find it in again.
 *
 * Kept OUT of the notification store on purpose: the store is the inbox
 * (realtime arrivals land in it, and the Alerts badge moves with it), and the
 * badge never counts archived rows. Only fetched while `enabled`.
 */
export function useArchivedNotifications(userId: string | undefined, enabled: boolean) {
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const q = useQuery<ArchivedPage>(
    ['notifications', userId ?? 'anon', 'archived'],
    () => fetchArchivedPage(1),
    { enabled, staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  // A (re)fetched head page starts the list over.
  useEffect(() => {
    if (!q.data) return;
    setRows(q.data.list);
    setPage(1);
    setHasMore(q.data.hasMore);
  }, [q.data]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const more = await fetchArchivedPage(next);
      setRows((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...more.list.filter((n) => !seen.has(n.id))];
      });
      setPage(next);
      setHasMore(more.hasMore);
    } catch {
      // Soft-fail — `hasMore` stays true so scrolling again retries.
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [hasMore, page]);

  // Read synchronously by removeRow (a state updater runs too late to report).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  /** Take a row out (moved back to the inbox). Returns its index, for a rollback. */
  const removeRow = useCallback((id: string): number => {
    const index = rowsRef.current.findIndex((n) => n.id === id);
    setRows((prev) => prev.filter((n) => n.id !== id));
    return index;
  }, []);

  const restoreRow = useCallback((item: AppNotification, index: number) => {
    setRows((prev) => {
      if (prev.some((n) => n.id === item.id)) return prev;
      const next = [...prev];
      next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
      return next;
    });
  }, []);

  /** Opened from the archive: read here too (the badge never counted it). */
  const markReadLocal = useCallback((id: string) => {
    setRows((prev) => prev.map((n) => (n.id === id && !n.is_read ? { ...n, is_read: true } : n)));
  }, []);

  return {
    rows,
    loading: q.loading,
    error: q.error,
    isStale: q.isStale,
    updatedAt: q.updatedAt,
    refresh: q.refresh,
    hasMore,
    loadingMore,
    loadMore,
    removeRow,
    restoreRow,
    markReadLocal,
  };
}
