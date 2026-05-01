import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { MessageCircle, Image as ImageIcon, Info } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import { BackButton } from '../ui/BackButton';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { chatService } from '../../services/chat.service';
import { useAuthStore } from '../../stores/authStore';
import type { Conversation } from '../../types';

/** Renders the chat inbox. The same component drives the customer and
 *  runner chat list screens — only the post-tap navigation prefix differs.
 */
interface Props {
  /** Where tapping a row navigates. The booking id is appended. */
  chatHrefPrefix: '/(customer)/chat' | '/(runner)/chat';
  /** Fallback href when the back button can't pop a stack. */
  fallbackHref: '/(customer)/(tabs)/activity' | '/(runner)/(tabs)/history';
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Looking for runner',
  matched: 'Runner assigned',
  accepted: 'Accepted',
  heading_to_pickup: 'Heading to pickup',
  arrived_at_pickup: 'At pickup',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  arrived_at_dropoff: 'At drop-off',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_runner: 'No runner found',
  negotiate: 'Negotiating',
};

export function ConversationList({ chatHrefPrefix, fallbackHref }: Props) {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');

  const conversationsQ = useQuery<Conversation[]>(
    ['chat', 'conversations', userId],
    async () => {
      const res = await chatService.getConversations();
      return res.data?.data ?? [];
    },
    { staleTime: 15_000, ttl: CacheTTL.SHORT },
  );

  const conversations = conversationsQ.data ?? [];

  // Bucket: unread first, then everything else by recency (already
  // server-sorted). The unread cluster gives a clear "needs attention"
  // top-of-list pattern familiar from Messenger / WhatsApp.
  const sorted = useMemo(() => {
    const unread = conversations.filter((c) => c.unread_count > 0);
    const read = conversations.filter((c) => c.unread_count === 0);
    return [...unread, ...read];
  }, [conversations]);

  const onRefresh = useCallback(async () => {
    await conversationsQ.refresh();
  }, [conversationsQ]);

  const renderRow = useCallback(
    ({ item }: { item: Conversation }) => {
      const unread = item.unread_count > 0;
      const lm = item.last_message;
      const previewBase =
        lm?.is_image
          ? 'Photo'
          : lm?.preview ?? (lm?.is_system ? 'System update' : 'No messages yet');
      const preview =
        lm?.is_outgoing && lm?.preview && !lm.is_system
          ? `You: ${previewBase}`
          : previewBase;
      const subtitle = item.errand_type?.name
        ? `${item.errand_type.name}${
            item.booking_number ? ` · #${item.booking_number}` : ''
          }`
        : STATUS_LABEL[item.status] ?? item.status;

      return (
        <Pressable
          onPress={() => router.push(`${chatHrefPrefix}/${item.booking_id}` as any)}
          className="flex-row items-center px-5 py-3 active:bg-surface"
          accessibilityRole="button"
          accessibilityLabel={`Open chat with ${item.counterparty?.full_name ?? 'participant'}`}
          accessibilityHint={
            unread ? `${item.unread_count} unread messages` : undefined
          }
        >
          <View>
            <Avatar
              uri={item.counterparty?.avatar_url}
              name={item.counterparty?.full_name ?? '?'}
              size="md"
            />
            {unread && (
              <View
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  paddingHorizontal: 4,
                  backgroundColor: '#DC2626',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: '#FFFFFF',
                }}
              >
                <Text className="text-[10px] font-montserrat-bold text-white">
                  {item.unread_count > 9 ? '9+' : item.unread_count}
                </Text>
              </View>
            )}
          </View>

          <View className="flex-1 ml-3">
            <View className="flex-row items-center justify-between">
              <Text
                className={`text-sm ${
                  unread
                    ? 'font-montserrat-bold text-textPrimary'
                    : 'font-montserrat-semi text-textPrimary'
                }`}
                numberOfLines={1}
              >
                {item.counterparty?.full_name ?? 'Errand partner'}
              </Text>
              <Text
                className={`text-[11px] ml-2 ${
                  unread ? 'font-montserrat-bold text-primary' : 'font-montserrat text-textTertiary'
                }`}
              >
                {timeAgo(lm?.created_at ?? null)}
              </Text>
            </View>

            <Text
              className="text-[11px] font-montserrat text-textTertiary mt-0.5"
              numberOfLines={1}
            >
              {subtitle}
            </Text>

            <View className="flex-row items-center mt-1">
              {lm?.is_image && (
                <ImageIcon size={12} color="#94A3B8" style={{ marginRight: 4 }} />
              )}
              {lm?.is_system && (
                <Info size={12} color="#94A3B8" style={{ marginRight: 4 }} />
              )}
              <Text
                className={`flex-1 text-xs ${
                  unread
                    ? 'font-montserrat-semi text-textPrimary'
                    : 'font-montserrat text-textSecondary'
                }`}
                numberOfLines={1}
              >
                {preview}
              </Text>
            </View>
          </View>
        </Pressable>
      );
    },
    [chatHrefPrefix, router],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-3">
        <BackButton fallbackHref={fallbackHref} />
        <Text className="text-lg font-montserrat-semi text-textPrimary ml-2">
          Messages
        </Text>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(c) => c.booking_id}
        renderItem={renderRow}
        ItemSeparatorComponent={() => (
          <View className="h-px bg-border ml-[76px]" />
        )}
        refreshControl={
          <RefreshControl
            refreshing={conversationsQ.loading && !!conversationsQ.data}
            onRefresh={onRefresh}
          />
        }
        ListEmptyComponent={
          !conversationsQ.loading ? (
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              description="When you start an errand, your chat with the runner will appear here."
            />
          ) : null
        }
        contentContainerStyle={
          sorted.length === 0 ? { flexGrow: 1 } : { paddingBottom: 24 }
        }
      />
    </SafeAreaView>
  );
}
