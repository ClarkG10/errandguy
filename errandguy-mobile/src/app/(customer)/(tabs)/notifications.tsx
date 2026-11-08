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
  Wallet,
  MessageCircle,
  AlertTriangle,
  Info,
  FileText,
  Archive,
  ArchiveRestore,
  Trash2,
  Headphones,
  Megaphone,
  RefreshCw,
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
import { pendingNotificationDeletes } from '../../../utils/pendingNotificationDeletes';
import { runOptimistic } from '../../../utils/optimistic';
import { queueable } from '../../../services/mutationQueue';
import { warmTracking } from '../../../services/preload.service';
import { notificationRoute } from '../../../utils/notificationRoute';
import { useQuery } from '../../../hooks/useQuery';
import { useArchivedNotifications } from '../../../hooks/useArchivedNotifications';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { useHideTabBarOnScroll } from '../../../hooks/useHideTabBarOnScroll';
import { CacheTTL } from '../../../services/cache.service';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton, SkeletonCircle } from '../../../components/ui/Skeleton';
import { SlowNetworkNotice } from '../../../components/ui/SlowNetworkNotice';
import { PushOffNotice } from '../../../components/customer/home/PushOffNotice';
import { StatePanel } from '../../../components/customer/home/StatePanel';
import { useBookingStore } from '../../../stores/bookingStore';
import { formatRelativeTime } from '../../../utils/formatDate';
import { storage } from '../../../utils/storage';
import type { AppNotification, NotificationType } from '../../../types';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';
import { toast } from '../../../stores/toastStore';
import { toastMaxDuration } from '../../../components/ui/ToastProvider';

// Per-type presentation: a lucide icon inside a soft-tinted chip plus
// the accent used for the unread dot and glyph. Blue-first — only
// payment/sos borrow the existing status semantics. `textColor`
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
    chipClass: 'bg-surfaceMuted',
  },
  // Live progress ticks (shopping checklist / extra stops) — same booking
  // accent as a status update; their real surface is the tracking screen.
  shopping_items_updated: {
    icon: Package,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-surfaceMuted',
  },
  booking_stops_updated: {
    icon: Package,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-surfaceMuted',
  },
  payment: {
    icon: Wallet,
    color: LightColors.success,
    textColor: LightColors.successDark,
    chipClass: 'bg-successSoft',
  },
  chat: {
    icon: MessageCircle,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-surfaceMuted',
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
    chipClass: 'bg-surfaceMuted',
  },
  // Same surface as document_update — both land the runner on their documents.
  onboarding_reminder: {
    icon: FileText,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-surfaceMuted',
  },
  // Support desk replies / status changes — open the ticket thread.
  support_reply: {
    icon: Headphones,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-surfaceMuted',
  },
  support_status: {
    icon: Headphones,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-surfaceMuted',
  },
  // Staff announcement — informational, nowhere further to go.
  broadcast: {
    icon: Megaphone,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-surfaceMuted',
  },
};

// Short, capitalised label per type — reads as a tiny eyebrow on each
// row.
const TYPE_LABELS: Record<NotificationType, string> = {
  booking_update: 'Booking',
  shopping_items_updated: 'Shopping',
  booking_stops_updated: 'Stops',
  payment: 'Payment',
  chat: 'Message',
  sos: 'Safety',
  system: 'System',
  document_update: 'Document',
  onboarding_reminder: 'Sign-up',
  support_reply: 'Support',
  support_status: 'Support',
  broadcast: 'ErrandGuy',
};

// Category filter chips — a coarser grouping over the TYPE_META types
// so users can narrow the inbox without a per-type chip explosion.
// "More" sweeps up the low-volume types (chat / safety / system /
// document). Purely client-side.
type CategoryKey = 'all' | 'bookings' | 'payments' | 'more';

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'payments', label: 'Payments' },
  { key: 'more', label: 'More' },
];

const CATEGORY_TYPES: Record<Exclude<CategoryKey, 'all'>, NotificationType[]> =
  {
    bookings: ['booking_update', 'shopping_items_updated', 'booking_stops_updated'],
    payments: ['payment'],
    // onboarding_reminder sits here with document_update: both are KYC-ish
    // nudges, and without an entry it appeared under "All" ONLY — invisible
    // the moment any chip was selected.
    more: [
      'chat',
      'sos',
      'system',
      'document_update',
      'onboarding_reminder',
      'support_reply',
      'support_status',
      'broadcast',
    ],
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
const DELETED_TOAST = 'Notification deleted';
// The server delete waits until the Undo toast can no longer be on screen
// (its longest stay, screen reader included), so Undo works for as long as
// it is visible. A fixed 4s used to close the window while Undo still showed.
const UNDO_DELETE_MS = toastMaxDuration(DELETED_TOAST, true) + 500;

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
  /** Shown in the archive: the one action is "Move to inbox". */
  archived?: boolean;
  onPress: (item: AppNotification) => void;
  /** Archive — or, for an archived row, move it back to the inbox. */
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
  archived = false,
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

  // In the archive the one swipe action is the way back.
  const renderMoveToInbox = () => (
    <View className="flex-row items-center h-full pl-2">
      <Pressable
        onPress={() => onArchive(item)}
        className="items-center justify-center px-3 py-2.5"
        style={({ pressed }) => [
          { minWidth: 60, borderRadius: 14, backgroundColor: LightColors.primaryLight },
          pressed && { opacity: 0.8 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Move ${item.title} to inbox`}
      >
        <ArchiveRestore size={18} color={LightColors.primaryDark} strokeWidth={1.9} />
        <Text
          className="text-[12px] font-montserrat-semi mt-1"
          style={{ color: LightColors.primaryDark }}
        >
          Move to inbox
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View className="px-5 pb-2">
      <ReanimatedSwipeable
        ref={swipeRef}
        // Swipe-left reveal: Archive (tinted "safe" action) + Delete
        // (danger). Each action fills the row height and is >=44pt
        // wide; labels + icons carry a composed accessibilityLabel so
        // a screen reader announces the target notification, not just
        // "Delete".
        renderRightActions={archived ? renderMoveToInbox : () => (
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
          accessibilityActions={
            archived
              ? [{ name: 'archive', label: 'Move to inbox' }]
              : [
                  { name: 'archive', label: 'Archive' },
                  { name: 'delete', label: 'Delete' },
                ]
          }
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'archive') onArchive(item);
            else if (e.nativeEvent.actionName === 'delete' && !archived) onDelete(item);
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
  // The empty inbox's next step: the errand that's running, when there is
  // one. (The store can also hold a finished errand tracking just loaded.)
  const liveErrandId = useBookingStore((s) => {
    const b = s.activeBooking;
    return b && !['completed', 'cancelled', 'no_runner'].includes(b.status) ? b.id : null;
  });
  // Per-key selectors so unrelated store updates don't recreate the
  // setter references (which would re-fire `useEffect`s that depend on
  // them and trigger redundant fetches / store writes).
  const notifications = useNotificationStore((s) => s.notifications);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const refreshUnreadCount = useNotificationStore((s) => s.refreshUnreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const remove = useNotificationStore((s) => s.remove);
  const restoreAt = useNotificationStore((s) => s.restoreAt);
  const clear = useNotificationStore((s) => s.clear);
  const userId = useAuthStore((s) => s.user?.id);
  const reducedMotion = useReducedMotion();
  const hideOnScroll = useHideTabBarOnScroll();

  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<CategoryKey>('all');
  // The archive replaces the inbox list while it's open; `category` keeps the
  // inbox chip to return to.
  const [showArchived, setShowArchived] = useState(false);
  const archived = useArchivedNotifications(userId, showArchived);
  const {
    removeRow: removeArchivedRow,
    restoreRow: restoreArchivedRow,
    markReadLocal: markArchivedReadLocal,
  } = archived;
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
  // Set when fetching the next page failed. FlatList won't fire onEndReached
  // again at the same scroll position, so a silent failure left an inbox that
  // just stopped with no way to get older notifications; the footer offers
  // "Try again" instead, and nothing pages on its own until it's tapped.
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  // Live registry of each row's swipeable methods plus which row (if
  // any) currently has its actions exposed — Apple Mail keeps at most
  // one row open at a time, so do we.
  const rowRefs = useRef(
    new Map<string, React.RefObject<SwipeableMethods | null>>(),
  );
  const openRowIdRef = useRef<string | null>(null);

  // The chips are a SERVER filter now, and part of the cache key so switching
  // category refetches. They used to filter the loaded rows only, so a busy
  // inbox could show "No payment notifications yet" while the payment rows sat
  // unfetched on page three.
  const categoryTypes =
    category === 'all' ? undefined : CATEGORY_TYPES[category].join(',');
  // Lets a page that was still loading when the chip changed be dropped
  // instead of landing in the new category's list.
  const categoryTypesRef = useRef(categoryTypes);
  categoryTypesRef.current = categoryTypes;
  useEffect(() => {
    setLoadMoreFailed(false);
  }, [category]);

  const notifQ = useQuery<AppNotification[]>(
    ['notifications', userId ?? 'anon', category],
    async () => {
      const r = await notificationService.getNotifications({
        page: 1,
        per_page: 20,
        types: categoryTypes,
      });
      const list = (r.data?.data ?? []) as AppNotification[];
      // Reset pagination state whenever the head page is (re)fetched.
      setPage(1);
      setLoadMoreFailed(false);
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

  const fetchMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    const forTypes = categoryTypes;
    try {
      const next = page + 1;
      // Must carry the category too, or page 2 of a filtered view returns
      // every type and the list mixes categories under one chip.
      const r = await notificationService.getNotifications({
        page: next,
        per_page: 20,
        types: forTypes,
      });
      if (categoryTypesRef.current !== forTypes) return;
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
      // Keep `hasMore` true; the footer's "Try again" retries this page.
      if (categoryTypesRef.current === forTypes) setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [page, categoryTypes, setNotifications]);

  const handleLoadMore = useCallback(() => {
    // After a failure, wait for the explicit retry tap.
    if (!hasMore || loadMoreFailed) return;
    void fetchMore();
  }, [hasMore, loadMoreFailed, fetchMore]);

  // Sync the rows into the global store as the query updates. The badge is
  // NOT derived from them (they are one page of one category) — it is re-read
  // from the server's unread total whenever the inbox loads.
  useEffect(() => {
    if (notifQ.data) {
      setNotifications(notifQ.data);
      void refreshUnreadCount();
    }
  }, [notifQ.data, setNotifications, refreshUnreadCount]);

  const refreshArchived = archived.refresh;
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await (showArchived ? refreshArchived() : notifQ.refresh());
    setRefreshing(false);
  }, [showArchived, refreshArchived, notifQ]);

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
    // Snapshot the list (with its original read flags) AND the badge so a
    // failure restores the exact prior state.
    const prev = useNotificationStore.getState().notifications;
    const prevUnread = useNotificationStore.getState().unreadCount;
    const q = queueable('notification.markAllRead', {}, { dedupeKey: 'notif-mark-all-read' });
    await runOptimistic({
      apply: () => markAllRead(),
      rollback: () => useNotificationStore.getState().restore(prev, prevUnread),
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
  // whose server deletes already succeeded. Undoable like delete: archiving
  // used to hide a row for good, with no way back.
  const handleArchive = useCallback(
    async (item: AppNotification) => {
      Haptics.selectionAsync().catch(() => {});
      if (openRowIdRef.current === item.id) openRowIdRef.current = null;
      const index = useNotificationStore
        .getState()
        .notifications.findIndex((n) => n.id === item.id);
      remove(item.id);
      const archiving = notificationService.archiveNotification(item.id);
      let undone = false;
      toast.info('Notification archived', {
        actionLabel: 'Undo',
        onAction: () => {
          undone = true;
          restoreAt(item, index);
          // Unarchive only once the archive has landed — sent side by side,
          // they could arrive out of order and leave it archived after all.
          void archiving
            .then(
              () => notificationService.unarchiveNotification(item.id),
              () => undefined, // the archive itself failed: nothing to undo
            )
            .catch(() => {
              remove(item.id);
              toast.error("Couldn't undo. You'll find it under Archived.");
            });
        },
      });
      try {
        await archiving;
      } catch {
        if (undone) return;
        restoreAt(item, index);
        toast.error("Couldn't archive notification. Please try again.");
      }
    },
    [remove, restoreAt],
  );

  // From the archive: back into the inbox (the inbox refetches on success).
  const handleUnarchive = useCallback(
    async (item: AppNotification) => {
      Haptics.selectionAsync().catch(() => {});
      if (openRowIdRef.current === item.id) openRowIdRef.current = null;
      const index = removeArchivedRow(item.id);
      try {
        await notificationService.unarchiveNotification(item.id);
        toast.success('Moved back to your inbox');
      } catch {
        restoreArchivedRow(item, index);
        toast.error("Couldn't move it back. Please try again.");
      }
    },
    [removeArchivedRow, restoreArchivedRow],
  );

  // Delete is optimistic AND undoable: the row disappears immediately,
  // but the server call is deferred so the Undo toast action can cancel
  // it and splice the row back at its original index. Undo is the safety net
  // — there's no confirm dialog in front of it (that made one delete three
  // steps; the runner's inbox has always just offered Undo).
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
      // Outlives this screen (utils/pendingNotificationDeletes): the Undo
      // toast does, so leaving the inbox must not send the delete early.
      pendingNotificationDeletes.schedule(item.id, UNDO_DELETE_MS, () => {
        notificationService.deleteNotification(item.id).catch(() => {
          restoreAt(item, index);
          toast.error("Couldn't delete notification. Please try again.");
        });
      });
      toast.info(DELETED_TOAST, {
        actionLabel: 'Undo',
        onAction: () => {
          // Window already closed — the server delete is in flight.
          if (!pendingNotificationDeletes.cancel(item.id)) return;
          restoreAt(item, index);
        },
      });
    },
    [remove, restoreAt],
  );

  const handleClearAll = useCallback(async () => {
    // ConfirmModal fires the destructive warning haptic on confirm.
    const prev = useNotificationStore.getState().notifications;
    const prevUnread = useNotificationStore.getState().unreadCount;
    // Clear-all supersedes any deferred single-row deletes.
    pendingNotificationDeletes.cancelAll();
    // Close the modal first: the list empties optimistically, and a rollback
    // restores it. Toasts can't render above a native Modal, so the failure
    // toast must fire after the dialog is gone.
    setClearConfirmVisible(false);
    await runOptimistic({
      apply: () => clear(),
      rollback: () => useNotificationStore.getState().restore(prev, prevUnread),
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
        // markRead is a no-op for an archived row (it isn't in the inbox
        // store), so the badge — which never counted it — doesn't move.
        markRead(notification.id);
        markArchivedReadLocal(notification.id);
        notificationService.markAsRead(notification.id).catch(() => {});
      }

      // Same destinations as the device push (utils/notificationRoute), so a
      // row and its push can never disagree. Rows with nowhere further to go
      // (a staff announcement) stay put — marking them read is the action.
      const target = notificationRoute(notification, 'customer', 'inbox');
      if (!target) return;
      // Warm the tracking fetch before navigating (only the id is known here,
      // so no store seed) so the screen's mount GET coalesces instead of
      // landing cold. (P2)
      const bookingId = notification.data?.booking_id;
      if (target.startsWith('/(customer)/tracking/') && typeof bookingId === 'string') {
        warmTracking(bookingId);
      }
      router.push(target as never);
    },
    [router, markRead, markArchivedReadLocal, closeOpenRow],
  );

  const renderNotification = useCallback(
    ({ item }: { item: AppNotification }) => (
      <NotificationRow
        item={item}
        archived={showArchived}
        onPress={handleNotificationPress}
        onArchive={showArchived ? handleUnarchive : handleArchive}
        onDelete={handleDelete}
        registerRow={registerRow}
        onRowWillOpen={handleRowWillOpen}
        onRowClose={handleRowClose}
      />
    ),
    [
      showArchived,
      handleNotificationPress,
      handleArchive,
      handleUnarchive,
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
    () =>
      showArchived
        ? archived.rows
        : notifications.filter((n) => matchesCategory(n.type, category)),
    [showArchived, archived.rows, notifications, category],
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
  const initialLoading = showArchived
    ? archived.loading && archived.rows.length === 0
    : notifQ.loading && notifications.length === 0;
  // The list the footer, pull-to-refresh and sync pill speak for.
  const listLoadingMore = showArchived ? archived.loadingMore : loadingMore;
  const listHasMore = showArchived ? archived.hasMore : hasMore;

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Notifications"
        trailing={
          !showArchived && notifications.length > 0 ? (
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
          const active = !showArchived && category === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setShowArchived(false);
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
        {/* Not a category: it swaps the inbox for the archive, where an
            archived notification can be read again or moved back. */}
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            closeOpenRow();
            setShowArchived(true);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          className={`px-4 py-2 rounded-full ${showArchived ? 'bg-primary' : 'bg-surfaceMuted'}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: showArchived }}
          accessibilityLabel="Archived notifications"
        >
          <Text
            className={`text-[13px] ${
              showArchived
                ? 'font-montserrat-bold text-white'
                : 'font-montserrat-semi text-textSecondary'
            }`}
          >
            Archived
          </Text>
        </Pressable>
      </ScrollView>

      {/* Ambient sync status — kept quiet: tiny tertiary pill tucked
          under the chips, above the list. Returns null on cold load so
          it never collides with the skeleton rows. */}
      <View className="px-5 pb-1">
        <SyncIndicator
          syncing={showArchived ? archived.isStale : notifQ.isStale}
          updatedAt={showArchived ? archived.updatedAt : notifQ.updatedAt}
          error={showArchived ? !!archived.error : !!notifQ.error}
          // Pattern 4: offline, the cached inbox stays and this says so.
          offline={!showArchived && !!notifQ.servedFromCacheOffline}
          onRetry={showArchived ? archived.refresh : notifQ.refresh}
          align="flex-start"
        />
      </View>

      {/* Pattern 7: the phone refused notifications. This inbox still fills
          while the app is open; say so, and offer Settings. */}
      <PushOffNotice
        fallbackLine="This list still updates whenever the app is open."
        style={{ marginHorizontal: 20, marginBottom: 8 }}
      />

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
        {...hideOnScroll}
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
        onEndReached={showArchived ? archived.loadMore : handleLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          listLoadingMore ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                Loading…
              </Text>
            </View>
          ) : (showArchived ? archived.loadMoreFailed : loadMoreFailed) &&
            visibleNotifications.length > 0 ? (
            // Only under rows already shown — on an empty list the error state
            // above carries the retry, and two retries for one failure is noise.
            // Same inline retry as the runner's history and the wallet.
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                void (showArchived ? archived.retryLoadMore() : fetchMore());
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading more notifications"
              className="mx-5 my-2 py-3 rounded-2xl border border-divider bg-surface flex-row items-center justify-center"
              style={{ minHeight: 44 }}
            >
              <RefreshCw size={14} color={LightColors.primary} strokeWidth={2} />
              <Text className="text-[12px] font-montserrat-bold text-primary ml-2">
                Couldn’t load more · Try again
              </Text>
            </Pressable>
          ) : !listHasMore && visibleNotifications.length > 0 ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                {showArchived ? 'That’s everything you’ve archived' : "You're all caught up"}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          initialLoading ? (
            // First fetch in flight — placeholder rows, never the
            // empty state. Past ~4s, pattern 5 says it's the connection.
            <View>
              <NotificationSkeletonRows />
              <View className="px-5 mt-2">
                <SlowNetworkNotice
                  loading
                  onRetry={() => {
                    void (showArchived ? archived.refresh() : notifQ.refresh());
                  }}
                />
              </View>
            </View>
          ) : showArchived ? (
            archived.error ? (
              <ErrorState
                title="Couldn't load archived notifications"
                error={archived.error}
                onRetry={() => {
                  void archived.refresh();
                }}
              />
            ) : (
              <StatePanel
                icon={Archive}
                title="Nothing archived"
                description="Notifications you archive are kept here, so you can read them again or move them back to your inbox."
                actionLabel="Back to inbox"
                onAction={() => setShowArchived(false)}
              />
            )
          ) : notifQ.error && notifications.length === 0 ? (
            <ErrorState
              title="Couldn't load notifications"
              error={notifQ.error}
              onRetry={() => {
                notifQ.refresh();
              }}
            />
          ) : category !== 'all' && notifications.length > 0 ? (
            // The inbox has items, just none in this category.
            <StatePanel
              icon={Bell}
              title={`No ${CATEGORIES.find((c) => c.key === category)?.label.toLowerCase() ?? ''} notifications`}
              description="Your other notifications are under All."
              actionLabel="Show all notifications"
              onAction={() => setCategory('all')}
            />
          ) : (
            // Pattern 1: why it's empty, then the one next step — follow the
            // errand that's running, or book one to have something to hear
            // about.
            <StatePanel
              icon={Bell}
              title="No notifications yet"
              description="We’ll let you know when a runner accepts your errand, and at every step after that."
              {...(liveErrandId
                ? {
                    actionLabel: 'Track your errand',
                    onAction: () => router.push(`/(customer)/tracking/${liveErrandId}` as any),
                  }
                : {
                    actionLabel: 'Book an errand',
                    onAction: () => router.push('/(customer)/book/type' as any),
                  })}
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
