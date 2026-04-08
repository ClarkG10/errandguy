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
import { notificationService } from '../../../services/notification.service';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatRelativeTime } from '../../../utils/formatDate';
import type { AppNotification, NotificationType } from '../../../types';

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
  const {
    notifications,
    setNotifications,
    markRead,
    markAllRead,
    setUnreadCount,
  } = useNotificationStore();

  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const [notifRes, countRes] = await Promise.all([
        notificationService.getNotifications(),
        notificationService.getUnreadCount(),
      ]);
      setNotifications(notifRes.data.data ?? []);
      setUnreadCount(countRes.data.data?.count ?? 0);
    } catch {
      // Silently handle
    }
  }, [setNotifications, setUnreadCount]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  }, [fetchNotifications]);

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
          className={`flex-row px-5 py-4 border-b border-divider ${
            !item.is_read ? 'bg-primaryLight/20' : ''
          }`}
          onPress={() => handleNotificationPress(item)}
        >
          {/* Unread dot */}
          {!item.is_read && (
            <View className="w-2 h-2 rounded-full bg-primary mt-2 mr-2" />
          )}
          {item.is_read && <View className="w-2 mr-2" />}

          {/* Icon */}
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: color + '20' }}
          >
            <Icon size={18} color={color} />
          </View>

          {/* Content */}
          <View className="flex-1">
            <Text
              className={`text-sm font-montserrat${
                !item.is_read ? '-bold' : ''
              } text-textPrimary`}
            >
              {item.title}
            </Text>
            <Text
              className="text-xs font-montserrat text-textSecondary mt-0.5"
              numberOfLines={2}
            >
              {item.body}
            </Text>
            <Text className="text-[10px] font-montserrat text-textSecondary mt-1">
              {formatRelativeTime(item.created_at)}
            </Text>
          </View>
        </Pressable>
      );
    },
    [handleNotificationPress],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 py-4">
        <Text className="text-xl font-montserrat-bold text-textPrimary">
          Notifications
        </Text>
        {notifications.length > 0 && (
          <Pressable onPress={handleMarkAllRead}>
            <Text className="text-sm font-montserrat text-primary">
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
