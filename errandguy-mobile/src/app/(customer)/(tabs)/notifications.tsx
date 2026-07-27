import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  ScrollView,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bell,
  Package,
  CreditCard,
  Gift,
  MessageCircle,
  AlertTriangle,
  Info,
  FileText,
  Archive,
  Trash2,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { Eyebrow } from '../../../components/ui/Typography';
import { SyncIndicator } from '../../../components/ui/SyncIndicator';
import { LightColors } from '../../../constants/colors';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useAuthStore } from '../../../stores/authStore';
import { notificationService } from '../../../services/notification.service';
import { runOptimistic } from '../../../utils/optimistic';
import { queueable } from '../../../services/mutationQueue';
import { warmTracking, prefetchPromos } from '../../../services/preload.service';
import { useQuery } from '../../../hooks/useQuery';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { CacheTTL } from '../../../services/cache.service';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Illustration } from '../../../components/ui/Illustration';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton, SkeletonCircle } from '../../../components/ui/Skeleton';
import { formatRelativeTime } from '../../../utils/formatDate';
import { storage } from '../../../utils/storage';
import type { AppNotification, NotificationType } from '../../../types';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';
import { toast } from '../../../stores/toastStore';

// Per-type presentation: a lucide icon inside a soft-tinted chip plus
// the accent used for the unread dot and glyph. Blue-first — only
// payment/promo/sos borrow the existing status semantics. `textColor`
// is the small-text rung (the 10px eyebrow needs the darker shade to
// hit contrast; the 18px glyph keeps the brighter base tone).
const TYPE_META: Record<
  NotificationType,
  { icon: LucideIcon; color: string; textColor: string; chipClass: string }
> = {
  booking_update: {
    icon: Package,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-primaryLight',
  },
  payment: {
    icon: CreditCard,
    color: LightColors.success,
    textColor: LightColors.successDark,
    chipClass: 'bg-successSoft',
  },
  promo: {
    icon: Gift,
    color: LightColors.warning,
    textColor: LightColors.warningDark,
    chipClass: 'bg-warningSoft',
  },
  chat: {
    icon: MessageCircle,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-primaryLight',
  },
  sos: {
    icon: AlertTriangle,
    color: LightColors.danger,
    textColor: LightColors.dangerDark,
    chipClass: 'bg-dangerSoft',
  },
  system: {
    icon: Info,
    color: LightColors.textTertiary,
    textColor: LightColors.textTertiary,
    chipClass: 'bg-surfaceMuted',
  },
  document_update: {
    icon: FileText,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-primaryLight',
  },
};

// Short, capitalised label per type — reads as a tiny eyebrow on each
// row.
const TYPE_LABELS: Record<NotificationType, string> = {
  booking_update: 'Booking',
  payment: 'Payment',
  promo: 'Promo',
  chat: 'Message',
  sos: 'Safety',
  system: 'System',
  document_update: 'Document',
};

// Category filter chips — a coarser grouping over the TYPE_META types
// so users can narrow the inbox without a per-type chip explosion.
// "More" sweeps up the low-volume types (chat / safety / system /
// document). Purely client-side.
type CategoryKey = 'all' | 'bookings' | 'payments' | 'promos' | 'more';

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'payments', label: 'Payments' },
  { key: 'promos', label: 'Promos' },
  { key: 'more', label: 'More' },
];

const CATEGORY_TYPES: Record<Exclude<CategoryKey, 'all'>, NotificationType[]> =
  {
    bookings: ['booking_update'],
    payments: ['payment'],
    promos: ['promo'],
    more: ['chat', 'sos', 'system', 'document_update'],
  };

function matchesCategory(type: NotificationType, category: CategoryKey) {
  if (category === 'all') return true;
  return CATEGORY_TYPES[category].includes(type);
}

// One-time swipe-teaching flag (peek animation, or a caption under the
// chips when Reduce Motion is on).
const SWIPE_HINT_KEY = 'notif_swipe_hint_v1';

// How long a swipe-delete stays undoable before the server call fires.
// Slightly shorter than the toast-with-action display time (5s) so the
// Undo button never outlives the window it controls.
const UNDO_DELETE_MS = 4000;

/** Placeholder rows shown during the very first fetch so the empty
 *  state can't flash before we know whether the inbox is empty. */
function NotificationSkeletonRows() {
  return (
    <View className="px-5 pt-2">
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          className="flex-row rounded-xl border border-divider p-3.5 mb-2 bg-surface"
        >
          <SkeletonCircle size={40} />
          <View className="flex-1 ml-3">
            <Skeleton width="30%" height={9} style={{ marginBottom: 8 }} />
            <Skeleton width="70%" height={13} style={{ marginBottom: 6 }} />
            <Skeleton width="90%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

interface NotificationRowProps {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
  onArchive: (item: AppNotification) => void;
  onDelete: (item: AppNotification) => void;
  /** Registers this row's swipeable methods with the screen (single-
   *  open-row tracking + the one-time teaching peek). Called with null
   *  on unmount. */
  registerRow: (
    id: string,
    ref: React.RefObject<SwipeableMethods | null> | null,
  ) => void;
  onRowWillOpen: (id: string) => void;
  onRowClose: (id: string) => void;
}

const NotificationRow = React.memo(function NotificationRow({
  item,
  onPress,
  onArchive,
  onDelete,
  registerRow,
  onRowWillOpen,
  onRowClose,
}: NotificationRowProps) {
  const swipeRef = useRef<SwipeableMethods | null>(null);

  useEffect(() => {
    registerRow(item.id, swipeRef);
    return () => registerRow(item.id, null);
  }, [item.id, registerRow]);

  const meta = TYPE_META[item.type] ?? TYPE_META.system;
  const label = TYPE_LABELS[item.type] ?? 'Update';
  const TypeIcon = meta.icon;

  return (
    <View className="px-5 pb-2">
      <ReanimatedSwipeable
        ref={swipeRef}
        // Swipe-left reveal: Archive (tinted "safe" action) + Delete
        // (danger). Each action fills the row height and is >=44pt
        // wide; labels + icons carry a composed accessibilityLabel so
        // a screen reader announces the target notification, not just
        // "Delete".
        renderRightActions={() => (
          // Floating rounded action chips, vertically centered in the row —
          // reads as two deliberate buttons rather than the old pair of flat
          // full-height rectangles whose square corners poked past the
          // rounded card edge.
          <View className="flex-row items-center h-full pl-2" style={{ gap: 8 }}>
            <Pressable
              onPress={() => onArchive(item)}
              className="items-center justify-center px-3 py-2.5"
              style={({ pressed }) => [
                { minWidth: 60, borderRadius: 14, backgroundColor: LightColors.primaryLight },
                pressed && { opacity: 0.8 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Archive ${item.title}`}
            >
              <Archive
                size={18}
                color={LightColors.primaryDark}
                strokeWidth={1.9}
              />
              <Text
                className="text-[12px] font-montserrat-semi mt-1"
                style={{ color: LightColors.primaryDark }}
              >
                Archive
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onDelete(item)}
              className="items-center justify-center px-3 py-2.5"
              style={({ pressed }) => [
                { minWidth: 60, borderRadius: 14, backgroundColor: LightColors.danger },
                pressed && { opacity: 0.8 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.title}`}
            >
              <Trash2 size={18} color="#FFFFFF" strokeWidth={1.9} />
              <Text className="text-[12px] font-montserrat-semi text-white mt-1">
                Delete
              </Text>
            </Pressable>
          </View>
        )}
        overshootRight={false}
        friction={2}
        rightThreshold={40}
        onSwipeableWillOpen={() => onRowWillOpen(item.id)}
        onSwipeableClose={() => onRowClose(item.id)}
      >
        <Pressable
          // White card row; unread rows get the soft brand-tinted
          // wash (primaryLight) so the eye lands on what needs
          // attention without the row reading as a chip.
          className={`flex-row rounded-xl border border-divider p-3.5 ${
            item.is_read ? 'bg-surface' : 'bg-primaryLight'
          }`}
          style={({ pressed }) => pressed && { opacity: 0.85 }}
          onPress={() => onPress(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.is_read ? '' : 'Unread. '}${label}: ${item.title}. ${formatRelativeTime(item.created_at)}`}
          // Swipe actions are unreachable to screen readers — expose
          // them on the rotor so VoiceOver users get per-row
          // archive/delete too.
          accessibilityActions={[
            { name: 'archive', label: 'Archive' },
            { name: 'delete', label: 'Delete' },
          ]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'archive') onArchive(item);
            else if (e.nativeEvent.actionName === 'delete') onDelete(item);
          }}
        >
          {/* Type icon chip — soft tinted circle + type accent icon. */}
          <View
            className={`w-10 h-10 rounded-full items-center justify-center ${meta.chipClass}`}
          >
            <TypeIcon size={18} color={meta.color} strokeWidth={1.9} />
          </View>
          <View className="flex-1 ml-3">
            <View className="flex-row items-center mb-0.5">
              <Text
                className="text-[10px] font-montserrat-bold uppercase"
                style={{ color: meta.textColor, letterSpacing: 1.2 }}
                numberOfLines={1}
              >
                {label}
              </Text>
              <Text
                className="text-[10px] font-montserrat text-textTertiary ml-2"
                numberOfLines={1}
              >
                · {formatRelativeTime(item.created_at)}
              </Text>
              {!item.is_read && (
                <View className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </View>
            <Text
              className={`text-[14px] mb-0.5 ${
                !item.is_read
                  ? 'font-montserrat-bold text-textPrimary'
                  : 'font-montserrat-semi text-textSecondary'
              }`}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            <Text
              className="text-[12px] font-montserrat text-textSecondary leading-[16px]"
              numberOfLines={2}
            >
              {item.body}
            </Text>
          </View>
        </Pressable>
      </ReanimatedSwipeable>
    </View>
  );
});

export default function NotificationsScreen() {
  const router = useRouter();
  // Per-key selectors so unrelated store updates don't recreate the
  // setter references (which would re-fire `useEffect`s that depend on
  // them and trigger redundant fetches / store writes).
  const notifications = useNotificationStore((s) => s.notifications);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const remove = useNotificationStore((s) => s.remove);
  const restoreAt = useNotificationStore((s) => s.restoreAt);
  const clear = useNotificationStore((s) => s.clear);
  const userId = useAuthStore((s) => s.user?.id);
  const reducedMotion = useReducedMotion();

  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<CategoryKey>('all');
  const [clearConfirmVisible, setClearConfirmVisible] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Reduce Motion fallback for the swipe teaching peek — a dismissible
  // one-liner under the chips instead of a surprise animation.
  const [swipeHintCaption, setSwipeHintCaption] = useState(false);
  const swipeHintDoneRef = useRef(false);
  // Pagination state. The server returns 20 per page — the previous UI
  // never requested page 2, so notifications older than the most recent
  // 20 were unreachable for the user.
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // Live registry of each row's swipeable methods plus which row (if
  // any) currently has its actions exposed — Apple Mail keeps at most
  // one row open at a time, so do we.
  const rowRefs = useRef(
    new Map<string, React.RefObject<SwipeableMethods | null>>(),
  );
  const openRowIdRef = useRef<string | null>(null);
  // Deferred server deletes keyed by notification id (undo window).
  const pendingDeletes = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );

  const notifQ = useQuery<AppNotification[]>(
    ['notifications', userId ?? 'anon'],
    async () => {
      const r = await notificationService.getNotifications({ page: 1, per_page: 20 });
      const list = (r.data?.data ?? []) as AppNotification[];
      // Reset pagination state whenever the head page is (re)fetched.
      setPage(1);
      // The Laravel paginator response surfaces last_page / current_page
      // at the top level; fall back to a length heuristic if the meta
      // shape changes.
      const meta = r.data?.meta ?? r.data;
      const lastPage = Number(meta?.last_page ?? meta?.['last_page']);
      setHasMore(
        Number.isFinite(lastPage) ? lastPage > 1 : list.length >= 20,
      );
      return list;
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  const handleLoadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const r = await notificationService.getNotifications({ page: next, per_page: 20 });
      const more = (r.data?.data ?? []) as AppNotification[];
      const meta = r.data?.meta ?? r.data;
      const lastPage = Number(meta?.last_page ?? meta?.['last_page']);
      // Append while deduping in case Realtime has already inserted any
      // of these into the head of the list.
      const existingIds = new Set(
        (useNotificationStore.getState().notifications ?? []).map((n) => n.id),
      );
      const fresh = more.filter((n) => !existingIds.has(n.id));
      if (fresh.length > 0) {
        setNotifications([
          ...useNotificationStore.getState().notifications,
          ...fresh,
        ]);
      }
      setPage(next);
      setHasMore(Number.isFinite(lastPage) ? next < lastPage : more.length >= 20);
    } catch {
      // Soft-fail — keep `hasMore` true so user can retry by scrolling.
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [hasMore, page, setNotifications]);

  // Sync into the global store as the query updates. setNotifications
  // recomputes the unread badge from the payload itself.
  useEffect(() => {
    if (notifQ.data) {
      setNotifications(notifQ.data);
    }
  }, [notifQ.data, setNotifications]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await notifQ.refresh();
    setRefreshing(false);
  }, [notifQ]);

  const registerRow = useCallback(
    (id: string, ref: React.RefObject<SwipeableMethods | null> | null) => {
      if (ref) rowRefs.current.set(id, ref);
      else rowRefs.current.delete(id);
    },
    [],
  );

  const handleRowWillOpen = useCallback((id: string) => {
    const prev = openRowIdRef.current;
    if (prev && prev !== id) rowRefs.current.get(prev)?.current?.close();
    openRowIdRef.current = id;
  }, []);

  const handleRowClose = useCallback((id: string) => {
    if (openRowIdRef.current === id) openRowIdRef.current = null;
  }, []);

  const closeOpenRow = useCallback(() => {
    const openId = openRowIdRef.current;
    if (openId) rowRefs.current.get(openId)?.current?.close();
    openRowIdRef.current = null;
  }, []);

  // One-time swipe-affordance teaching: peek the first row's actions
  // open then closed after the list settles. Under Reduce Motion we
  // skip the animation and show a dismissible caption instead.
  const firstRowId = notifications.length > 0 ? notifications[0].id : null;
  useEffect(() => {
    if (swipeHintDoneRef.current || !firstRowId) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    storage
      .get(SWIPE_HINT_KEY)
      .then((seen) => {
        if (cancelled || seen || swipeHintDoneRef.current) return;
        swipeHintDoneRef.current = true;
        storage.set(SWIPE_HINT_KEY, '1').catch(() => {});
        if (reducedMotion) {
          setSwipeHintCaption(true);
          return;
        }
        timers.push(
          setTimeout(() => {
            const row = rowRefs.current.get(firstRowId)?.current;
            if (!row) return;
            row.openRight();
            timers.push(setTimeout(() => row.close(), 700));
          }, 600),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [firstRowId, reducedMotion]);

  const handleMarkAllRead = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    // Snapshot the list (with its original read flags) so a failure restores
    // the exact prior state; setNotifications recomputes the unread badge.
    const prev = useNotificationStore.getState().notifications;
    const q = queueable('notification.markAllRead', {}, { dedupeKey: 'notif-mark-all-read' });
    await runOptimistic({
      apply: () => markAllRead(),
      rollback: () => useNotificationStore.getState().setNotifications(prev),
      commit: q.commit,
      offline: q.offline,
      errorMessage: "Couldn't mark all as read. Please try again.",
      retry: true,
      offlineMessage: null,
    });
  }, [markAllRead]);

  // Optimistically drop the row, then reconcile with the server. On
  // failure we restore ONLY the failed row at its original index —
  // a full-snapshot rollback could resurrect rows removed concurrently
  // whose server deletes already succeeded.
  const handleArchive = useCallback(
    async (item: AppNotification) => {
      Haptics.selectionAsync().catch(() => {});
      if (openRowIdRef.current === item.id) openRowIdRef.current = null;
      const index = useNotificationStore
        .getState()
        .notifications.findIndex((n) => n.id === item.id);
      remove(item.id);
      try {
        await notificationService.archiveNotification(item.id);
      } catch {
        restoreAt(item, index);
        toast.error("Couldn't archive notification. Please try again.");
      }
    },
    [remove, restoreAt],
  );

  // Delete is optimistic AND undoable: the row disappears immediately,
  // but the server call is deferred so the Undo toast action can cancel
  // it and splice the row back at its original index.
  const handleDelete = useCallback(
    (item: AppNotification) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => {},
      );
      if (openRowIdRef.current === item.id) openRowIdRef.current = null;
      const index = useNotificationStore
        .getState()
        .notifications.findIndex((n) => n.id === item.id);
      remove(item.id);
      const timer = setTimeout(() => {
        pendingDeletes.current.delete(item.id);
        notificationService.deleteNotification(item.id).catch(() => {
          restoreAt(item, index);
          toast.error("Couldn't delete notification. Please try again.");
        });
      }, UNDO_DELETE_MS);
      pendingDeletes.current.set(item.id, timer);
      toast.info('Notification deleted', {
        actionLabel: 'Undo',
        onAction: () => {
          const pending = pendingDeletes.current.get(item.id);
          // Window already closed — the server delete is in flight.
          if (!pending) return;
          clearTimeout(pending);
          pendingDeletes.current.delete(item.id);
          restoreAt(item, index);
        },
      });
    },
    [remove, restoreAt],
  );

  const handleClearAll = useCallback(async () => {
    // ConfirmModal fires the destructive warning haptic on confirm.
    const prev = useNotificationStore.getState().notifications;
    // Clear-all supersedes any deferred single-row deletes.
    pendingDeletes.current.forEach((t) => clearTimeout(t));
    pendingDeletes.current.clear();
    // Close the modal first: the list empties optimistically, and a rollback
    // restores it. Toasts can't render above a native Modal, so the failure
    // toast must fire after the dialog is gone.
    setClearConfirmVisible(false);
    await runOptimistic({
      apply: () => clear(),
      rollback: () => useNotificationStore.getState().setNotifications(prev),
      commit: () => notificationService.clearAll(),
      errorMessage: "Couldn't clear notifications. Please try again.",
      retry: true,
    });
  }, [clear]);

  const handleNotificationPress = useCallback(
    (notification: AppNotification) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      closeOpenRow();

      // Optimistic mark-as-read: update the store and navigate NOW;
      // the server call is fire-and-forget (markRead is idempotent, so
      // the worst case is the row re-rendering unread on next fetch).
      if (!notification.is_read) {
        markRead(notification.id);
        notificationService.markAsRead(notification.id).catch(() => {});
      }

      // Navigate based on type
      const data = notification.data ?? {};
      switch (notification.type) {
        case 'booking_update':
          if (data.booking_id) {
            // Warm the tracking fetch before navigating (only the id is known
            // here, so no store seed) so the screen's mount GET coalesces
            // instead of landing cold from a push tap. (P2)
            warmTracking(data.booking_id as string);
            router.push(
              `/(customer)/tracking/${data.booking_id as string}`,
            );
          }
          break;
        case 'payment':
          router.push('/(customer)/wallet');
          break;
        case 'chat':
          if (data.booking_id) {
            router.push(
              `/(customer)/chat/${data.booking_id as string}`,
            );
          }
          break;
        case 'promo':
          // The Profile-focus prefetch doesn't cover a promo deep-link (it
          // never mounts Profile), so warm the promos list on the tap too. (P32)
          if (userId) prefetchPromos(userId);
          router.push('/(customer)/promos');
          break;
        default:
          break;
      }
    },
    [router, markRead, closeOpenRow, userId],
  );

  const renderNotification = useCallback(
    ({ item }: { item: AppNotification }) => (
      <NotificationRow
        item={item}
        onPress={handleNotificationPress}
        onArchive={handleArchive}
        onDelete={handleDelete}
        registerRow={registerRow}
        onRowWillOpen={handleRowWillOpen}
        onRowClose={handleRowClose}
      />
    ),
    [
      handleNotificationPress,
      handleArchive,
      handleDelete,
      registerRow,
      handleRowWillOpen,
      handleRowClose,
    ],
  );

  // Group notifications into time buckets so the list reads like an
  // Inbox rather than an endless wall. Bucket boundaries use the device
  // local clock for "Today / Yesterday" and a 7-day window for "This Week".
  const visibleNotifications = useMemo(
    () => notifications.filter((n) => matchesCategory(n.type, category)),
    [notifications, category],
  );

  const sections = useMemo(() => {
    if (!visibleNotifications.length) return [];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

    const buckets: Record<string, AppNotification[]> = {
      Today: [],
      Yesterday: [],
      'This Week': [],
      Earlier: [],
    };

    for (const n of visibleNotifications) {
      const ts = new Date(n.created_at).getTime();
      if (ts >= startOfToday) buckets.Today.push(n);
      else if (ts >= startOfYesterday) buckets.Yesterday.push(n);
      else if (ts >= startOfWeek) buckets['This Week'].push(n);
      else buckets.Earlier.push(n);
    }

    // Drop empty buckets and preserve order.
    return (['Today', 'Yesterday', 'This Week', 'Earlier'] as const)
      .filter((title) => buckets[title].length > 0)
      .map((title) => ({ title, data: buckets[title] }));
  }, [visibleNotifications]);

  const renderSectionHeader = useCallback(
    ({ section: { title, data } }: { section: { title: string; data: AppNotification[] } }) => {
      const unreadInSection = data.filter((n) => !n.is_read).length;
      return (
        <View className="flex-row items-baseline justify-between px-5 pt-4 pb-2 bg-background">
          <Eyebrow>{title}</Eyebrow>
          {unreadInSection > 0 && (
            <Eyebrow color={LightColors.primary}>
              {unreadInSection} new
            </Eyebrow>
          )}
        </View>
      );
    },
    [],
  );

  // Only treat it as the *initial* load when the query is fetching and
  // the store has nothing yet — this is what previously let "No
  // notifications" flash during the first fetch.
  const initialLoading = notifQ.loading && notifications.length === 0;

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Notifications"
        trailing={
          notifications.length > 0 ? (
            // gap 20 + inner hitSlop trimmed to 8 keeps the two hit
            // rects from overlapping between "Mark all read" and the
            // destructive trash.
            <View className="flex-row items-center" style={{ gap: 20 }}>
              <Pressable
                onPress={handleMarkAllRead}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Mark all as read"
              >
                <Text className="text-[12px] font-montserrat-bold text-primary">
                  Mark all read
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setClearConfirmVisible(true);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Clear all notifications"
              >
                <Trash2 size={20} color={LightColors.danger} strokeWidth={1.9} />
              </Pressable>
            </View>
          ) : undefined
        }
      />

      {/* Category filter chips — client-side narrowing over TYPE_META
          groupings. Horizontal scroll so a fifth chip or a longer
          localized label never clips at 375pt widths. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-2 mb-2"
        // A horizontal ScrollView has no reliable intrinsic HEIGHT inside a
        // flex column — when the SectionList below fills with data the layout
        // pass collapses this row to a sliver (only the top of the pills
        // shows), while an empty list happens to measure fine. Pinning an
        // explicit height makes the row deterministic regardless of the list
        // below; alignItems centres the pills within it.
        style={{ flexGrow: 0, flexShrink: 0, height: 50 }}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, alignItems: 'center' }}
      >
        {CATEGORIES.map((c) => {
          const active = category === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setCategory(c.key);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              className={`px-4 py-2 rounded-full ${
                active ? 'bg-primary' : 'bg-surfaceMuted'
              }`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${c.label} notifications`}
            >
              <Text
                className={`text-[13px] ${
                  active
                    ? 'font-montserrat-bold text-white'
                    : 'font-montserrat-semi text-textSecondary'
                }`}
              >
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Ambient sync status — kept quiet: tiny tertiary pill tucked
          under the chips, above the list. Returns null on cold load so
          it never collides with the skeleton rows. */}
      <View className="px-5 pb-1">
        <SyncIndicator
          syncing={notifQ.isStale}
          updatedAt={notifQ.updatedAt}
          error={!!notifQ.error}
          onRetry={notifQ.refresh}
          align="flex-start"
        />
      </View>

      {swipeHintCaption && (
        <View className="flex-row items-center px-5 pb-2">
          <Text className="flex-1 text-[12px] font-montserrat text-textSecondary">
            Swipe a notification left to archive or delete it
          </Text>
          <Pressable
            onPress={() => setSwipeHintCaption(false)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Dismiss swipe hint"
          >
            <Text className="text-[12px] font-montserrat-bold text-primary ml-3">
              Got it
            </Text>
          </Pressable>
        </View>
      )}

      {/* Notification List */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderNotification}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: TAB_CONTENT_BOTTOM_INSET }}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                Loading…
              </Text>
            </View>
          ) : !hasMore && visibleNotifications.length > 0 ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                You're all caught up
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          initialLoading ? (
            // First fetch in flight — placeholder rows, never the
            // empty state.
            <NotificationSkeletonRows />
          ) : notifQ.error && notifications.length === 0 ? (
            <ErrorState
              title="Couldn't load notifications"
              onRetry={() => {
                notifQ.refresh();
              }}
            />
          ) : category !== 'all' && notifications.length > 0 ? (
            // The inbox has items, just none in this category.
            <EmptyState
              illustration={<Illustration name="empty-notifications" size={168} />}
              title="Nothing here"
              description={`No ${CATEGORIES.find((c) => c.key === category)?.label.toLowerCase() ?? ''} notifications yet`}
              secondaryActionLabel="Show all"
              onSecondaryAction={() => setCategory('all')}
            />
          ) : (
            <EmptyState
              illustration={<Illustration name="empty-notifications" size={168} />}
              title="No notifications"
              description="You'll see updates about your errands here"
            />
          )
        }
      />

      <ConfirmModal
        visible={clearConfirmVisible}
        title="Clear all notifications?"
        message="This permanently removes every notification from your inbox. This can't be undone."
        confirmLabel="Clear all"
        confirmLoadingLabel="Clearing…"
        cancelLabel="Cancel"
        destructive
        loading={clearing}
        onConfirm={handleClearAll}
        onCancel={() => setClearConfirmVisible(false)}
      />
    </View>
  );
}
