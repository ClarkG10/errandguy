import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
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
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useAuthStore } from '../../../stores/authStore';
import { notificationService } from '../../../services/notification.service';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatRelativeTime } from '../../../utils/formatDate';
import type { AppNotification, NotificationType } from '../../../types';
import { toast } from '../../../stores/toastStore';

const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  booking_update: Package,
  payment: CreditCard,
  promo: Tag,
  chat: MessageCircle,
  sos: AlertTriangle,
  system: Info,
  document_update: Info,
};

const TYPE_COLORS: Record<NotificationType, string> = {
  booking_update: '#2563EB',
  payment: '#22C55E',
  promo: '#F59E0B',
  chat: '#3B82F6',
  sos: '#EF4444',
  system: '#94A3B8',
  document_update: '#8B5CF6',
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

  const notifQ = useQuery<AppNotification[]>(
    ['notifications', userId ?? 'anon'],
    async () => {
      const r = await notificationService.getNotifications();
      return (r.data.data ?? []) as AppNotification[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

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
      const Icon = TYPE_ICONS[item.type] ?? Info;
      const color = TYPE_COLORS[item.type] ?? '#94A3B8';

      return (
        <Pressable
          className="mx-5 mb-2 rounded-2xl bg-surface px-4 py-3.5"
          style={{
            borderWidth: 1,
            borderColor: !item.is_read ? '#DBEAFE' : '#F1F5F9',
          }}
          onPress={() => handleNotificationPress(item)}
        >
          <View className="flex-row">
            {/* Icon */}
            <View
              className="w-9 h-9 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: color + '12' }}
            >
              <Icon size={16} color={color} />
            </View>

            {/* Content */}
            <View className="flex-1">
              <View className="flex-row items-center justify-between mb-0.5">
                <Text
                  className={`text-[13px] ${
                    !item.is_read ? 'font-montserrat-semi' : 'font-montserrat'
                  } text-textPrimary flex-1 mr-2`}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                {!item.is_read && (
                  <View className="w-2 h-2 rounded-full bg-primary" />
                )}
              </View>
              <Text
                className="text-xs font-montserrat text-textTertiary leading-4"
                numberOfLines={2}
              >
                {item.body}
              </Text>
              <Text className="text-[10px] font-montserrat text-textTertiary mt-1.5 opacity-60">
                {formatRelativeTime(item.created_at)}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    },
    [handleNotificationPress],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-4 pb-3">
        <Text className="text-lg font-montserrat-semi text-textPrimary">
          Notifications
        </Text>
        {notifications.length > 0 && (
          <Pressable onPress={handleMarkAllRead} className="px-3 py-1.5 rounded-lg bg-primary50">
            <Text className="text-[11px] font-montserrat-semi text-primary">
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      {/* Notification List */}
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderNotification}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
        ListEmptyComponent={
          <EmptyState
            icon={Bell}
            title="No notifications"
            description="You'll see updates about your errands here"
          />
        }
      />
    </SafeAreaView>
  );
}
