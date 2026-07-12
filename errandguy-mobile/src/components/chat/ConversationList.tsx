import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { MessageCircle, Image as ImageIcon, Info } from 'lucide-react-native';
import { Avatar } from '../ui/Avatar';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { ChatInboxSkeleton } from '../ui/Skeleton';
import { GradientHeader } from '../ui/GradientHeader';
import { SyncIndicator } from '../ui/SyncIndicator';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { chatService } from '../../services/chat.service';
import { useAuthStore } from '../../stores/authStore';
import { LightColors } from '../../constants/colors';
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
  // Role-aware copy: a runner's counterparty is the customer, and vice
  // versa. Derived from the navigation prefix so the shared component
  // never says "your chat with the runner" to a runner.
  const isRunner = chatHrefPrefix.startsWith('/(runner)');

  const conversationsQ = useQuery<Conversation[]>(
    ['chat', 'conversations', userId],
    async () => {
      const res = await chatService.getConversations();
      return res.data?.data ?? [];
    },
    // Hydrate from disk immediately (TTL MEDIUM = 5min) so the inbox
    // paints instantly on every navigation; the network refetch in the
    // background still updates with fresh state once it lands.
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  const conversations = conversationsQ.data ?? [];

  // Slow-load watchdog — if the first load is still pending after 12s with
  // no cached data, stop showing skeletons forever and offer a retry. The
  // request itself can hang up to the 30s axios timeout; this gives the user
  // an escape hatch (and a clear signal) well before then. Resets whenever
  // loading finishes or data arrives.
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!conversationsQ.loading || conversationsQ.data) {
      setSlowLoad(false);
      return;
    }
    const t = setTimeout(() => setSlowLoad(true), 12000);
    return () => clearTimeout(t);
  }, [conversationsQ.loading, conversationsQ.data]);

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
        <Card
          onPress={() =>
            router.push(`${chatHrefPrefix}/${item.booking_id}` as any)
          }
          padding="sm"
          className="mx-5 mb-2.5"
          accessibilityLabel={`Open chat with ${item.counterparty?.full_name ?? 'participant'}`}
          accessibilityHint={
            unread ? `${item.unread_count} unread messages` : undefined
          }
        >
          <View className="flex-row items-center">
            <View>
              <Avatar
                uri={item.counterparty?.avatar_url}
                name={item.counterparty?.full_name ?? '?'}
                size="md"
              />
              {unread && (
                <View
                  className="bg-danger"
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    paddingHorizontal: 4,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: LightColors.surface,
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
                    unread
                      ? 'font-montserrat-bold text-primary'
                      : 'font-montserrat text-textMuted'
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
                  <ImageIcon
                    size={12}
                    color={LightColors.textMuted}
                    style={{ marginRight: 4 }}
                  />
                )}
                {lm?.is_system && (
                  <Info
                    size={12}
                    color={LightColors.textMuted}
                    style={{ marginRight: 4 }}
                  />
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
          </View>
        </Card>
      );
    },
    [chatHrefPrefix, router],
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Messages"
        showBack
        fallbackHref={fallbackHref}
      />

      <SyncIndicator
        syncing={conversationsQ.isStale}
        updatedAt={conversationsQ.updatedAt}
        error={!!conversationsQ.error}
        onRetry={onRefresh ?? conversationsQ.refresh}
      />

      <FlatList
        data={sorted}
        keyExtractor={(c) => c.booking_id}
        renderItem={renderRow}
        refreshControl={
          <RefreshControl
            refreshing={conversationsQ.loading && !!conversationsQ.data}
            onRefresh={onRefresh}
          />
        }
        ListEmptyComponent={
          conversationsQ.loading && slowLoad ? (
            // Load has been pending too long — surface a retry instead of an
            // endless skeleton (the "messages won't load" symptom).
            <ErrorState
              title="Messages are taking a while"
              description="Check your connection and try again."
              onRetry={() => {
                setSlowLoad(false);
                conversationsQ.refresh();
              }}
            />
          ) : conversationsQ.loading ? (
            // First load (no cached data yet) — skeleton rows shaped
            // like conversation cards so the inbox doesn't flash empty.
            <ChatInboxSkeleton />
          ) : conversationsQ.error ? (
            <ErrorState
              title="Couldn't load messages"
              onRetry={() => conversationsQ.refresh()}
            />
          ) : (
            <EmptyState
              icon={MessageCircle}
              title="No conversations yet"
              description={
                isRunner
                  ? 'When you accept an errand, your chat with the customer will appear here.'
                  : 'When you start an errand, your chat with the runner will appear here.'
              }
            />
          )
        }
        contentContainerStyle={
          sorted.length === 0 ? { flexGrow: 1 } : { paddingBottom: 24 }
        }
      />
    </View>
  );
}
