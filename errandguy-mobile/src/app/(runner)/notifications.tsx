import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bell,
  Package,
  CreditCard,
  Tag,
  MessageCircle,
  AlertTriangle,
  Info,
  FileCheck2,
  Archive,
  Trash2,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { ConfirmModal } from '../../components/ui/ConfirmModal';
import { BrandRefreshControl } from '../../components/ui/BrandRefreshControl';
import { RunnerEmptyState } from '../../components/ui/RunnerEmptyState';
import { Illustration } from '../../components/ui/Illustration';
import { ErrorState } from '../../components/ui/ErrorState';
import { Eyebrow } from '../../components/ui/Typography';
import { Skeleton, SkeletonCircle } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useAuthStore } from '../../stores/authStore';
import { notificationService } from '../../services/notification.service';
import { useQuery } from '../../hooks/useQuery';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { CacheTTL } from '../../services/cache.service';
import { formatRelativeTime } from '../../utils/formatDate';
import { storage } from '../../utils/storage';
import type { AppNotification, NotificationType } from '../../types';
import { LightColors } from '../../constants/colors';

// Per-type presentation: a lucide icon inside a soft-tinted chip plus
// the accent used for the unread dot and glyph. `textColor` is the
// small-text rung — the 10px eyebrow needs the darker shade to hit AA;
// the 18px glyph keeps the brighter base tone.
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
    icon: Tag,
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
    // textSecondary (not textTertiary) for the 10px uppercase eyebrow —
    // #64748B lands ~4.48:1, a hair under AA at this size; #475569 clears it.
    textColor: LightColors.textSecondary,
    chipClass: 'bg-surfaceMuted',
  },
  document_update: {
    icon: FileCheck2,
    color: LightColors.primary,
    textColor: LightColors.primary,
    chipClass: 'bg-primaryLight',
  },
};

// Short, capitalised label per type — reads as a tiny eyebrow on each
// row so category is legible without relying on the glyph colour alone.
const TYPE_LABELS: Record<NotificationType, string> = {
  booking_update: 'Booking',
  payment: 'Payment',
  promo: 'Promo',
  chat: 'Message',
  sos: 'Safety',
  system: 'System',
  document_update: 'Document',
};

// One-time swipe-teaching flag (peek animation, or a caption above the
// list when Reduce Motion is on).
const SWIPE_HINT_KEY = 'runner_notif_swipe_hint_v1';

// How long a swipe-delete stays undoable before the server call fires —
// slightly shorter than the toast-with-action display window (5s) so the
// Undo button never outlives the timer it controls.
const UNDO_DELETE_MS = 4000;

/** Placeholder rows shown during the very first fetch so the empty
 *  state can't flash before we know whether the inbox is empty. */
function NotificationSkeletonRows() {
  return (
    <View className="pt-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          className="flex-row px-5 py-3.5 border-b border-divider"
        >
          <SkeletonCircle size={40} />
          <View className="flex-1 ml-3">
            <Skeleton width="28%" height={9} style={{ marginBottom: 8 }} />
            <Skeleton width="65%" height={13} style={{ marginBottom: 6 }} />
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
    <ReanimatedSwipeable
      ref={swipeRef}
      renderRightActions={() => (
        <View className="flex-row">
          <Pressable
            onPress={() => onArchive(item)}
            className="bg-surfaceMuted items-center justify-center"
            style={({ pressed }) => [{ width: 76 }, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
            accessibilityLabel={`Archive ${item.title}`}
          >
            <Archive size={18} color={LightColors.textSecondary} strokeWidth={1.9} />
            <Text className="text-[12px] font-montserrat-semi text-textSecondary mt-1">
              Archive
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onDelete(item)}
            className="bg-danger items-center justify-center"
            style={({ pressed }) => [{ width: 76 }, pressed && { opacity: 0.8 }]}
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
        android_ripple={{ color: LightColors.surfaceMuted, borderless: false }}
        // Opaque row background so the revealed swipe-action panel doesn't
        // bleed through the content at rest; unread rows get the soft
        // brand wash so attention lands without hunting for the dot.
        className={`px-5 py-3.5 border-b border-divider ${
          item.is_read ? 'bg-background' : 'bg-primaryLight'
        }`}
        style={({ pressed }) => pressed && { opacity: 0.85 }}
        onPress={() => onPress(item)}
        accessibilityRole="button"
        // Compose read state into the label so screen-reader users hear
        // "Unread" before the title instead of hunting for the 6px dot.
        accessibilityLabel={`${item.is_read ? '' : 'Unread. '}${label}: ${item.title}. ${item.body ?? ''} ${formatRelativeTime(item.created_at)}`}
        // Swipe actions are unreachable to screen readers — expose them on
        // the rotor so VoiceOver/TalkBack users get per-row archive/delete.
        accessibilityActions={[
          { name: 'archive', label: 'Archive' },
          { name: 'delete', label: 'Delete' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'archive') onArchive(item);
          else if (e.nativeEvent.actionName === 'delete') onDelete(item);
        }}
      >
        <View className="flex-row">
          <View
            className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${meta.chipClass}`}
          >
            <TypeIcon size={18} color={meta.color} strokeWidth={1.9} />
          </View>
          <View className="flex-1">
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
                <View
                  className="ml-auto bg-primary"
                  style={{ width: 6, height: 6, borderRadius: 3 }}
                />
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
              className="text-[12px] font-montserrat text-textSecondary leading-4"
              numberOfLines={2}
            >
              {item.body}
            </Text>
          </View>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
});

export default function RunnerNotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const notifications = useNotificationStore((s) => s.notifications);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const remove = useNotificationStore((s) => s.remove);
  const restoreAt = useNotificationStore((s) => s.restoreAt);
  const clear = useNotificationStore((s) => s.clear);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const userId = useAuthStore((s) => s.user?.id);
  const reducedMotion = useReducedMotion();

  const [refreshing, setRefreshing] = useState(false);
  const [clearConfirmVisible, setClearConfirmVisible] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Reduce Motion fallback for the swipe teaching peek — a dismissible
  // one-liner above the list instead of a surprise animation.
  const [swipeHintCaption, setSwipeHintCaption] = useState(false);
  const swipeHintDoneRef = useRef(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // Live registry of each row's swipeable methods plus which row (if any)
  // currently has its actions exposed — keep at most one row open at a
  // time, like Apple Mail.
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
      setPage(1);
      const meta = r.data?.meta ?? r.data;
      const lastPage = Number(meta?.last_page ?? meta?.['last_page']);
      setHasMore(Number.isFinite(lastPage) ? lastPage > 1 : list.length >= 20);
      return list;
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  useEffect(() => {
    if (notifQ.data) {
      setNotifications(notifQ.data);
      setUnreadCount(notifQ.data.filter((n) => !n.is_read).length);
    }
  }, [notifQ.data, setNotifications, setUnreadCount]);

  // Cancel any still-pending deferred deletes when the screen unmounts so
  // their timers can't fire against a torn-down store.
  useEffect(() => {
    const pending = pendingDeletes.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

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
      // soft-fail; user can scroll again to retry
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [hasMore, page, setNotifications]);

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

  // One-time swipe-affordance teaching: peek the first row's actions open
  // then closed after the list settles. Under Reduce Motion we skip the
  // animation and show a dismissible caption instead.
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
    try {
      await notificationService.markAllAsRead();
      markAllRead();
    } catch {
      // ignore — UI state will reconcile on next refresh
    }
  }, [markAllRead]);

  // Optimistically drop the row, then reconcile with the server. On
  // failure restore ONLY the failed row at its original index — a
  // full-snapshot rollback could resurrect rows removed concurrently
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

  // Delete is optimistic AND undoable: the row disappears immediately, but
  // the server call is deferred so the Undo toast action can cancel it and
  // splice the row back at its original index.
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
    setClearing(true);
    try {
      await notificationService.clearAll();
      // Clear-all supersedes any deferred single-row deletes.
      pendingDeletes.current.forEach((t) => clearTimeout(t));
      pendingDeletes.current.clear();
      clear();
      setClearConfirmVisible(false);
    } catch {
      // Close the modal BEFORE toasting — toasts can't render above a
      // native Modal, so an error behind the open dialog is invisible.
      setClearConfirmVisible(false);
      toast.error("Couldn't clear notifications. Please try again.");
    } finally {
      setClearing(false);
    }
  }, [clear]);

  const handleNotificationPress = useCallback(
    async (n: AppNotification) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      closeOpenRow();
      if (!n.is_read) {
        try {
          await notificationService.markAsRead(n.id);
          markRead(n.id);
        } catch {
          // ignore
        }
      }
      const data = n.data ?? {};
      switch (n.type) {
        case 'booking_update':
          if (data.booking_id) {
            router.push(`/(runner)/errand/${data.booking_id as string}` as any);
          }
          break;
        case 'payment':
          router.push('/(runner)/(tabs)/earnings');
          break;
        case 'chat':
          if (data.booking_id) {
            router.push(`/(runner)/chat/${data.booking_id as string}` as any);
          }
          break;
        case 'document_update':
          router.push('/(runner)/settings/documents' as any);
          break;
        default:
          break;
      }
    },
    [router, markRead, closeOpenRow],
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

  const sections = useMemo(() => {
    if (!notifications.length) return [];
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
    for (const n of notifications) {
      const ts = new Date(n.created_at).getTime();
      if (ts >= startOfToday) buckets.Today.push(n);
      else if (ts >= startOfYesterday) buckets.Yesterday.push(n);
      else if (ts >= startOfWeek) buckets['This Week'].push(n);
      else buckets.Earlier.push(n);
    }
    return (['Today', 'Yesterday', 'This Week', 'Earlier'] as const)
      .filter((title) => buckets[title].length > 0)
      .map((title) => ({ title, data: buckets[title] }));
  }, [notifications]);

  const renderSectionHeader = useCallback(
    ({ section: { title, data } }: { section: { title: string; data: AppNotification[] } }) => {
      const unreadInSection = data.filter((n) => !n.is_read).length;
      return (
        <View className="flex-row items-baseline justify-between px-5 pt-4 pb-2 bg-background">
          <Eyebrow>{title}</Eyebrow>
          {unreadInSection > 0 && (
            <Eyebrow color={LightColors.primary}>{unreadInSection} new</Eyebrow>
          )}
        </View>
      );
    },
    [],
  );

  // Only treat it as the *initial* load when the query is fetching and the
  // store has nothing yet — this is what previously let the empty state
  // (or a blank screen) flash during the first fetch.
  const initialLoading = notifQ.loading && notifications.length === 0;

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Notifications"
        showBack
        fallbackHref="/(runner)/(tabs)"
        trailing={
          notifications.length > 0 ? (
            // gap 20 + inner hitSlop trimmed to 8 keeps the two hit rects
            // from overlapping between "Mark all read" and the destructive
            // trash, so a mis-tap can't fire an irreversible clear-all.
            <View className="flex-row items-center" style={{ gap: 20 }}>
              <Pressable
                onPress={handleMarkAllRead}
                hitSlop={{ top: 14, bottom: 14, left: 12, right: 8 }}
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
                hitSlop={{ top: 14, bottom: 14, left: 8, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel="Clear all notifications"
              >
                <Trash2 size={20} color={LightColors.danger} strokeWidth={1.9} />
              </Pressable>
            </View>
          ) : undefined
        }
      />

      {swipeHintCaption && (
        <View className="flex-row items-center px-5 pt-3 pb-1">
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
        removeClippedSubviews
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 + insets.bottom }}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                Loading…
              </Text>
            </View>
          ) : !hasMore && notifications.length > 0 ? (
            <View className="py-4 items-center">
              <Text className="text-xs font-montserrat text-textTertiary">
                You're all caught up
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          // Gate on the query state so the empty state can't flash during
          // the first fetch, and a failed first fetch reads as an error
          // (retryable) rather than a clear inbox.
          initialLoading ? (
            <NotificationSkeletonRows />
          ) : notifQ.error && notifications.length === 0 ? (
            <ErrorState
              title="Couldn't load notifications"
              onRetry={() => notifQ.refresh()}
            />
          ) : (
            <RunnerEmptyState
              illustration={<Illustration name="empty-notifications" size={168} />}
              eyebrow="Inbox clear"
              title="No notifications yet"
              description="Errand offers, payouts, and updates will land here as they happen."
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
