import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  RefreshControl,
  Pressable,
  ActivityIndicator,
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
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { LightColors } from '../../../constants/colors';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useAuthStore } from '../../../stores/authStore';
import { notificationService } from '../../../services/notification.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatRelativeTime } from '../../../utils/formatDate';
import type { AppNotification, NotificationType } from '../../../types';
import { TAB_CONTENT_BOTTOM_INSET } from '../../../constants/tabLayout';

// Per-type presentation: a lucide icon inside a soft-tinted chip plus
// the accent used for the eyebrow label and unread dot. Blue-first —
// only payment/promo/sos borrow the existing status semantics.
const TYPE_META: Record<
  NotificationType,
  { icon: LucideIcon; color: string; chipClass: string }
> = {
  booking_update: {
    icon: Package,
    color: LightColors.primary,
    chipClass: 'bg-primaryLight',
  },
  payment: {
    icon: CreditCard,
    color: LightColors.success,
    chipClass: 'bg-successSoft',
  },
  promo: {
    icon: Gift,
    color: LightColors.warning,
    chipClass: 'bg-warningSoft',
  },
  chat: {
    icon: MessageCircle,
    color: LightColors.primary,
    chipClass: 'bg-primaryLight',
  },
  sos: {
    icon: AlertTriangle,
    color: LightColors.danger,
    chipClass: 'bg-dangerSoft',
  },
  system: {
    icon: Info,
    color: LightColors.textTertiary,
    chipClass: 'bg-surfaceMuted',
  },
  document_update: {
    icon: FileText,
    color: LightColors.primary,
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

export default function NotificationsScreen() {
  const router = useRouter();
  // Per-key selectors so unrelated store updates don't recreate the
  // setter references (which would re-fire `useEffect`s that depend on
  // them and trigger redundant fetches / store writes).
  const notifications = useNotificationStore((s) => s.notifications);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const userId = useAuthStore((s) => s.user?.id);

  const [refreshing, setRefreshing] = useState(false);
  // Pagination state. The server returns 20 per page — the previous UI
  // never requested page 2, so notifications older than the most recent
  // 20 were unreachable for the user.
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

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

  // Sync into the global store as the query updates.
  useEffect(() => {
    if (notifQ.data) {
      setNotifications(notifQ.data);
      setUnreadCount(notifQ.data.filter((n) => !n.is_read).length);
    }
  }, [notifQ.data, setNotifications, setUnreadCount]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await notifQ.refresh();
    setRefreshing(false);
  }, [notifQ]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await notificationService.markAllAsRead();
      markAllRead();
    } catch {
      // Handle error
    }
  }, [markAllRead]);

  const handleNotificationPress = useCallback(
    async (notification: AppNotification) => {
      // Mark as read
      if (!notification.is_read) {
        try {
          await notificationService.markAsRead(notification.id);
          markRead(notification.id);
        } catch {
          // Handle error
        }
      }

      // Navigate based on type
      const data = notification.data ?? {};
      switch (notification.type) {
        case 'booking_update':
          if (data.booking_id) {
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
          router.push('/(customer)/(tabs)');
          break;
        default:
          break;
      }
    },
    [router, markRead],
  );

  const renderNotification = useCallback(
    ({ item }: { item: AppNotification }) => {
      const meta = TYPE_META[item.type] ?? TYPE_META.system;
      const label = TYPE_LABELS[item.type] ?? 'Update';
      const TypeIcon = meta.icon;

      return (
        <View className="px-5 pb-2">
          <Pressable
            // White card row; unread rows get the soft brand-tinted
            // wash (primaryLight) so the eye lands on what needs
            // attention without the row reading as a chip.
            className={`flex-row rounded-xl border border-divider p-3.5 ${
              item.is_read ? 'bg-surface' : 'bg-primaryLight'
            }`}
            onPress={() => handleNotificationPress(item)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${item.title}`}
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
                  style={{ color: meta.color, letterSpacing: 1.2 }}
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
        </View>
      );
    },
    [handleNotificationPress],
  );

  // Group notifications into time buckets so the list reads like an
  // Inbox rather than an endless wall. Bucket boundaries use the device
  // local clock for "Today / Yesterday" and a 7-day window for "This Week".
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

    // Drop empty buckets and preserve order.
    return (['Today', 'Yesterday', 'This Week', 'Earlier'] as const)
      .filter((title) => buckets[title].length > 0)
      .map((title) => ({ title, data: buckets[title] }));
  }, [notifications]);

  const renderSectionHeader = useCallback(
    ({ section: { title, data } }: { section: { title: string; data: AppNotification[] } }) => {
      const unreadInSection = data.filter((n) => !n.is_read).length;
      return (
        <View className="flex-row items-baseline justify-between px-5 pt-4 pb-2 bg-background">
          <Text className="text-[10px] font-montserrat-bold text-textSecondary uppercase" style={{ letterSpacing: 1.4 }}>
            {title}
          </Text>
          {unreadInSection > 0 && (
            <Text className="text-[10px] font-montserrat-bold text-primary uppercase" style={{ letterSpacing: 1.2 }}>
              {unreadInSection} new
            </Text>
          )}
        </View>
      );
    },
    [],
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Notifications"
        trailing={
          notifications.length > 0 ? (
            { label: 'Mark all read', onPress: handleMarkAllRead }
          ) : undefined
        }
      />

      {/* Notification List */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderNotification}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
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
              <ActivityIndicator size="small" color={LightColors.primary} />
            </View>
          ) : !hasMore && notifications.length > 0 ? (
            <View className="py-4 items-center">
              <Text className="text-[11px] font-montserrat text-textTertiary">
                You're all caught up
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon={Bell}
            title="No notifications"
            description="You'll see updates about your errands here"
          />
        }
      />
    </View>
  );
}
