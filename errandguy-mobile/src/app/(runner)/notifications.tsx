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
  Tag,
  MessageCircle,
  AlertTriangle,
  Info,
  FileCheck2,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { RunnerEmptyState } from '../../components/ui/RunnerEmptyState';
import { useNotificationStore } from '../../stores/notificationStore';
import { useAuthStore } from '../../stores/authStore';
import { notificationService } from '../../services/notification.service';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { formatRelativeTime } from '../../utils/formatDate';
import type { AppNotification, NotificationType } from '../../types';
import { LightColors } from '../../constants/colors';

const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  booking_update: Package,
  payment: CreditCard,
  promo: Tag,
  chat: MessageCircle,
  sos: AlertTriangle,
  system: Info,
  document_update: FileCheck2,
};

const TYPE_COLORS: Record<NotificationType, string> = {
  booking_update: LightColors.primary,
  payment: LightColors.success,
  promo: LightColors.warning,
  chat: LightColors.primary,
  sos: LightColors.danger,
  system: LightColors.textMuted,
  document_update: LightColors.info,
};

export default function RunnerNotificationsScreen() {
  const router = useRouter();
  const notifications = useNotificationStore((s) => s.notifications);
  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const userId = useAuthStore((s) => s.user?.id);

  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

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

  const handleMarkAllRead = useCallback(async () => {
    try {
      await notificationService.markAllAsRead();
      markAllRead();
    } catch {
      // ignore — UI state will reconcile on next refresh
    }
  }, [markAllRead]);

  const handleNotificationPress = useCallback(
    async (n: AppNotification) => {
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
    [router, markRead],
  );

  const renderNotification = useCallback(
    ({ item }: { item: AppNotification }) => {
      const Icon = TYPE_ICONS[item.type] ?? Info;
      const color = TYPE_COLORS[item.type] ?? LightColors.textMuted;

      return (
        <Pressable
          android_ripple={{ color: LightColors.surfaceMuted, borderless: false }}
          className="px-5 py-3.5 border-b border-divider"
          onPress={() => handleNotificationPress(item)}
        >
          <View className="flex-row">
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: `${color}15` }}
            >
              <Icon size={18} color={color} strokeWidth={1.7} />
            </View>
            <View className="flex-1">
              <View className="flex-row items-center mb-0.5">
                <Text
                  className={`text-[13px] flex-1 mr-2 ${
                    !item.is_read
                      ? 'font-montserrat-bold text-textPrimary'
                      : 'font-montserrat-semi text-textSecondary'
                  }`}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                {!item.is_read && (
                  <View className="bg-primary" style={{ width: 6, height: 6, borderRadius: 3 }} />
                )}
              </View>
              <Text
                className="text-[12px] font-montserrat text-textMuted leading-4"
                numberOfLines={2}
              >
                {item.body}
              </Text>
              <Text className="text-[10px] font-montserrat text-textMuted mt-1.5">
                {formatRelativeTime(item.created_at)}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    },
    [handleNotificationPress],
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
        <View className="flex-row items-center justify-between px-5 pt-4 pb-2 bg-background">
          <Text
            className="text-[10px] font-montserrat-bold uppercase text-textSecondary"
            style={{ letterSpacing: 1.4 }}
          >
            {title}
          </Text>
          {unreadInSection > 0 && (
            <Text className="text-[10px] font-montserrat-bold text-primary">
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
        showBack
        fallbackHref="/(runner)/(tabs)"
        trailing={
          notifications.length > 0
            ? { label: 'Mark all read', onPress: handleMarkAllRead }
            : undefined
        }
      />

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
        removeClippedSubviews
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
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
          <RunnerEmptyState
            icon={Bell}
            eyebrow="Inbox clear"
            title="No notifications yet"
            description="Errand offers, payouts, and updates will land here as they happen."
          />
        }
      />
    </View>
  );
}
