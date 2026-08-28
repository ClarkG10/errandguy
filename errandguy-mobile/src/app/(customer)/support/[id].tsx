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
import { useSmartPolling } from '../../../hooks/useSmartPolling';
import { useEchoChannel } from '../../../hooks/useEchoChannel';
import { useAuthStore } from '../../../stores/authStore';
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

/**
 * How many of the newest messages an open-thread refresh pulls. Small on
 * purpose: a support thread is short, and the refresh only needs to catch the
 * agent replies that landed since the last tick. If a whole page comes back
 * unknown we could be straddling a gap, so the screen resyncs from scratch
 * instead of stitching a possibly-out-of-order tail.
 */
const REFRESH_PAGE = 20;

/** Cadence of the open-thread refresh. Paused while backgrounded/offline and
 *  ticked immediately on foreground + reconnect by useSmartPolling. */
const REFRESH_INTERVAL_MS = 25_000;

/** Notification `data.type` values SupportTicketNotifier sends to the owner. */
const SUPPORT_NOTIFICATION_TYPES = ['support_reply', 'support_status'];

/**
 * The api layer serves GETs from an 8s micro-cache, so a realtime kick that
 * lands right after a poll tick can read a pre-reply page. When that happens
 * we retry once just past the window instead of making the user wait out the
 * whole poll interval.
 */
const MICRO_CACHE_GRACE_MS = 8_500;

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

  // Live mirrors so the refresh callback can diff against the current thread
  // without being re-created (and re-arming the poll) on every keystroke-driven
  // render, and without impure comparisons inside a state updater.
  const messagesRef = useRef<ThreadMessage[]>(messages);
  messagesRef.current = messages;
  const ticketRef = useRef<SupportTicket | null>(ticket);
  ticketRef.current = ticket;

  /**
   * Pull the newest slice of the thread and splice in anything we don't have.
   * Resolves to whether anything actually changed.
   *
   * Before this the screen fetched exactly once on mount: an agent replying
   * from /admin was invisible until the user backed out and re-opened the
   * ticket (paying the cold-fetch skeleton each time). The ticket object comes
   * back on every call, so a status change (resolved / closed / re-opened)
   * lands here too.
   *
   * Errors propagate so useSmartPolling's backoff engages.
   */
  const refreshThread = useCallback(async (): Promise<boolean> => {
    if (!id) return false;
    const r = await supportService.getTicket(id, { limit: REFRESH_PAGE });
    const head = r.data.data.messages ?? [];

    // Only re-set the ticket when something the UI shows actually moved —
    // otherwise every idle tick would re-render the screen for nothing.
    const nextTicket = r.data.data.ticket;
    const prevTicket = ticketRef.current;
    const ticketChanged =
      !prevTicket ||
      prevTicket.status !== nextTicket.status ||
      prevTicket.subject !== nextTicket.subject ||
      prevTicket.last_message_at !== nextTicket.last_message_at;
    if (ticketChanged) setTicket(nextTicket);

    const known = new Set(messagesRef.current.map((m) => m.id));
    const additions = head.filter((m) => !known.has(m.id));
    if (additions.length === 0) return ticketChanged;
    // A fully-unknown page means more arrived than we asked for — there could
    // be a hole between what we hold and this tail. Resync rather than guess.
    if (additions.length >= REFRESH_PAGE) {
      await loadInitial();
      return true;
    }
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = additions.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return prev;
      // Keep any in-flight optimistic bubble pinned to the very bottom so a
      // refresh landing mid-send doesn't jump the user's own message upwards.
      const settled = prev.filter((m) => !m.pending);
      const pending = prev.filter((m) => m.pending);
      return [...settled, ...fresh, ...pending];
    });
    return true;
  }, [id, loadInitial]);

  useSmartPolling(refreshThread, {
    interval: REFRESH_INTERVAL_MS,
    enabled: !!id,
    // The mount fetch (loadInitial) already covers the first paint; an extra
    // immediate tick would just duplicate it.
    runOnMount: false,
    pauseWhenOffline: true,
    backoffOnError: true,
  });

  // Realtime shortcut: the server pushes + broadcasts `support_reply` /
  // `support_status` (SupportTicketNotifier) on the owner's notification
  // channel. When one names THIS ticket, refresh now instead of waiting out
  // the poll — so an agent's answer appears while the user is still looking
  // at the thread. The channel is ref-counted, so co-subscribing alongside the
  // app-wide notifications hook is safe.
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    },
    [],
  );
  useEchoChannel({
    channel: `notifications.${userId}`,
    event: 'notification.created',
    enabled: !!userId && !!id,
    onEvent: (payload) => {
      const data = (payload?.data ?? {}) as Record<string, unknown>;
      const type = typeof payload?.type === 'string' ? payload.type : data.type;
      if (typeof type !== 'string' || !SUPPORT_NOTIFICATION_TYPES.includes(type)) return;
      const ticketId = data.ticket_id;
      if (ticketId != null && String(ticketId) !== String(id)) return;
      void (async () => {
        try {
          if (await refreshThread()) return;
          // Nothing new came back — almost certainly the micro-cache. Try once
          // more past its window; the poll stays the backstop either way.
          if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
          graceTimerRef.current = setTimeout(() => {
            graceTimerRef.current = null;
            void refreshThread().catch(() => {});
          }, MICRO_CACHE_GRACE_MS);
        } catch {
          /* the poll remains the fallback */
        }
      })();
    },
  });

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
