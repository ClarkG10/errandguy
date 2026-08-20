import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Send } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  supportService,
  type SupportMessage,
  type SupportTicket,
  type SupportTicketStatus,
} from '../../../services/support.service';
import { useKeyboard } from '../../../hooks/useKeyboard';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Spinner } from '../../../components/ui/Spinner';
import { ChatThreadSkeleton } from '../../../components/ui/Skeleton';
import { Badge } from '../../../components/ui/Badge';
import { ErrorState } from '../../../components/ui/ErrorState';
import { LightColors } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import { formatTime, formatChatDayLabel, localDayKey } from '../../../utils/formatDate';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { toast } from '../../../stores/toastStore';

// A thread message plus local-only send state.
type ThreadMessage = SupportMessage & { pending?: boolean };

type Row =
  | { kind: 'msg'; message: ThreadMessage }
  | { kind: 'day'; id: string; label: string };

const STATUS_META: Record<
  SupportTicketStatus,
  { label: string; variant: 'soft' | 'warning' | 'success' | 'neutral' }
> = {
  open: { label: 'Open', variant: 'soft' },
  pending: { label: 'Awaiting reply', variant: 'warning' },
  resolved: { label: 'Resolved', variant: 'success' },
  closed: { label: 'Closed', variant: 'neutral' },
};

/** Build the inverted-FlatList rows (newest at index 0) from a
 *  chronological (oldest → newest) message array, inserting day
 *  separators at calendar-day boundaries (same convention as the
 *  booking chat thread). */
function buildRows(messages: ThreadMessage[]): Row[] {
  if (messages.length === 0) return [];
  const reversed = [...messages].reverse();
  const rows: Row[] = [];
  for (let i = 0; i < reversed.length; i++) {
    const m = reversed[i];
    rows.push({ kind: 'msg', message: m });
    const next = reversed[i + 1]; // the older message in inverted order
    // Group by LOCAL calendar day (matches formatChatDayLabel) rather than the
    // raw UTC slice, which drifts up to 8h from the local day near midnight.
    const currentDay = m.created_at ? localDayKey(m.created_at) : undefined;
    const nextDay = next?.created_at ? localDayKey(next.created_at) : undefined;
    if (!next || currentDay !== nextDay) {
      // The separator is pushed right after message `m` and, because the
      // list is inverted, renders directly ABOVE it — so it must announce
      // m's OWN day, not the older neighbour's (using next.created_at here
      // filed every message under the previous calendar day).
      const labelDate = m.created_at;
      if (labelDate) {
        rows.push({
          kind: 'day',
          id: `day-${labelDate}-${m.id}`,
          label: formatChatDayLabel(labelDate),
        });
      }
    }
  }
  return rows;
}

export default function SupportThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { width, mScale } = useResponsive();
  const { isVisible: keyboardVisible } = useKeyboard();

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const loadingOlderRef = useRef(false);

  const loadInitial = useCallback(async () => {
    if (!id) return;
    setInitialLoading(true);
    setLoadError(false);
    try {
      const r = await supportService.getTicket(id);
      setTicket(r.data.data.ticket);
      setMessages(r.data.data.messages);
      setHasMore(r.data.meta.has_more);
      setNextBefore(r.data.meta.next_before);
    } catch {
      setLoadError(true);
    } finally {
      setInitialLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadOlder = useCallback(async () => {
    if (!id || !hasMore || loadingOlderRef.current || !nextBefore) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const r = await supportService.getTicket(id, { before: nextBefore });
      const older = r.data.data.messages;
      // Server returns each page ASC; older pages prepend before the
      // current chronological list.
      setMessages((prev) => [...older, ...prev]);
      setHasMore(r.data.meta.has_more);
      setNextBefore(r.data.meta.next_before);
    } catch {
      // Silent — the user can scroll up again to retry.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [id, hasMore, nextBefore]);

  const handleSend = useCallback(async () => {
    if (!id || sending) return;
    const text = inputText.trim();
    if (!text) return;

    setInputText('');
    setSending(true);
    // Optimistic bubble so the reply appears instantly at the bottom.
    const tempId = `temp-${Date.now()}`;
    const optimistic: ThreadMessage = {
      id: tempId,
      ticket_id: id,
      sender_id: null,
      sender_type: 'user',
      sender: null,
      content: text,
      image_url: null,
      read_at: null,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const r = await supportService.postMessage(id, text);
      const saved = r.data.data;
      setMessages((prev) => prev.map((m) => (m.id === tempId ? saved : m)));
      // A reply re-opens a resolved/closed ticket server-side → reflect it.
      setTicket((prev) =>
        prev && (prev.status === 'resolved' || prev.status === 'closed')
          ? { ...prev, status: 'pending' }
          : prev,
      );
    } catch {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error,
      ).catch(() => {});
      toast.error(errorMessage(undefined, copy.support.messageSendFailed));
      // Drop the optimistic bubble and restore the text for a retry.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInputText((prev) => (prev ? prev : text));
    } finally {
      setSending(false);
    }
  }, [id, sending, inputText]);

  const rows = useMemo(() => buildRows(messages), [messages]);

  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.kind === 'day') {
      return (
        <View className="items-center my-3">
          <View className="px-3 py-1 bg-divider/60 rounded-full">
            <Text className="text-[11px] font-montserrat-semi text-textSecondary">
              {item.label}
            </Text>
          </View>
        </View>
      );
    }

    const m = item.message;

    if (m.sender_type === 'system') {
      return (
        <View className="items-center my-2 px-4">
          <Text className="text-xs font-montserrat italic text-textSecondary text-center">
            {m.content}
          </Text>
        </View>
      );
    }

    const isMe = m.sender_type === 'user';
    // Clamp bubbles on wide screens: 80% of a phone is fine, but on a
    // tablet an unclamped 80% yields 100+ char lines (matches chat).
    const bubbleMaxWidth = Math.min(width * 0.8, 420);

    return (
      <View className={`my-1 px-4 ${isMe ? 'items-end' : 'items-start'}`}>
        {!isMe && (
          <Text
            className="text-[10px] font-montserrat-semi text-textTertiary mb-0.5 px-1"
            numberOfLines={1}
          >
            {m.sender?.full_name ?? 'Support'}
          </Text>
        )}
        <View
          className={`rounded-2xl px-4 py-2 ${
            isMe
              ? 'bg-primary rounded-br-sm'
              : 'bg-surface border border-divider rounded-bl-sm'
          }`}
          style={[
            { maxWidth: bubbleMaxWidth },
            isMe && m.pending ? { opacity: 0.7 } : null,
          ]}
        >
          <Text
            className={`text-base font-montserrat ${
              isMe ? 'text-white' : 'text-textPrimary'
            }`}
          >
            {m.content}
          </Text>
          <Text
            className={`text-[10px] font-montserrat mt-1 ${
              isMe ? 'text-white/90' : 'text-textSecondary'
            }`}
          >
            {m.pending ? 'Sending…' : m.created_at ? formatTime(m.created_at) : ''}
          </Text>
        </View>
      </View>
    );
  }, [width]);

  const statusMeta = ticket ? STATUS_META[ticket.status] ?? STATUS_META.open : null;

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title={ticket?.subject ?? 'Support'}
        showBack
        fallbackHref="/(customer)/support"
        flush
        trailing={
          statusMeta ? (
            <View className="pr-1">
              <Badge label={statusMeta.label} variant={statusMeta.variant} />
            </View>
          ) : undefined
        }
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // KAV measures from the screen edge, not from below the flush
        // header, so the offset must equal the real header height: safe-area
        // top inset + the GradientHeader title row (mScale(52) on iOS). A
        // constant can't cover this — Pro Max is 59+55≈114 while SE is
        // 20+52=72 and landscape ~52 — so compute it from live insets.
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + mScale(52) : 0}
      >
        <FlatList
          data={rows}
          keyExtractor={(item) => (item.kind === 'msg' ? item.message.id : item.id)}
          renderItem={renderRow}
          inverted
          className="flex-1"
          contentContainerStyle={{ paddingVertical: 12 }}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews
          initialNumToRender={20}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => {
            if (hasMore && !loadingOlderRef.current) loadOlder();
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingOlder ? (
              <View className="py-3 items-center">
                <Spinner size="small" color={LightColors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            initialLoading ? (
              // Counter-flip the skeleton (the list is inverted) and let it fill
              // the thread — matches the ordinary chat screens' first-load shimmer
              // instead of a lone spinner.
              <View style={{ transform: [{ scaleY: -1 }] }}>
                <ChatThreadSkeleton />
              </View>
            ) : (
              <View
                className="items-center justify-center py-20 px-8"
                style={{ transform: [{ scaleY: -1 }] }}
              >
                {loadError ? null : (
                  <Text className="text-sm font-montserrat text-textSecondary text-center">
                    No messages yet.
                  </Text>
                )}
              </View>
            )
          }
        />

        {loadError && messages.length === 0 ? (
          <View className="px-4 py-2">
            <ErrorState compact onRetry={loadInitial} />
          </View>
        ) : null}

        {ticket && (ticket.status === 'resolved' || ticket.status === 'closed') ? (
          <View className="px-4 py-2 bg-surfaceMuted border-t border-divider">
            <Text className="text-[12px] font-montserrat text-textSecondary text-center">
              This ticket is {ticket.status} — reply to reopen it.
            </Text>
          </View>
        ) : null}

        {/* Bottom padding tracks the system inset so the Android
            gesture/nav bar never overlaps the send button. When the iOS
            keyboard is up the KeyboardAvoidingView already lifts the
            composer above it, so the home-indicator inset would only open
            a dead gap between composer and keyboard — collapse it to 8pt
            (mirrors the booking chat composer). */}
        <View
          className="flex-row items-end px-4 pt-3 border-t border-divider bg-surface"
          style={{
            paddingBottom:
              Platform.OS === 'ios' && keyboardVisible
                ? 8
                : Math.max(insets.bottom, 12),
          }}
        >
          <TextInput
            className="flex-1 bg-background border border-divider rounded-2xl px-4 py-2.5 text-base font-montserrat text-textPrimary"
            style={{ maxHeight: 120, minHeight: 40 }}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message…"
            placeholderTextColor={LightColors.textMuted}
            multiline
            editable={!sending}
            accessibilityLabel="Message input"
          />
          <Pressable
            className={`ml-2 mb-1 w-10 h-10 rounded-full items-center justify-center ${
              sending || !inputText.trim() ? 'bg-dividerStrong' : 'bg-primary'
            }`}
            hitSlop={8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              handleSend();
            }}
            disabled={sending || !inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: sending || !inputText.trim() }}
          >
            {/* On the disabled/grey (dividerStrong) button a white glyph
                measures ~1.3:1 and effectively vanishes — drop to the muted
                ink rung (3.2:1 on that wash, clears the 3:1 non-text floor)
                so the inactive send target stays legible. */}
            {sending ? (
              <Spinner size="small" color={LightColors.textTertiary} />
            ) : (
              <Send
                size={18}
                color={inputText.trim() ? LightColors.textInverse : LightColors.textTertiary}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
