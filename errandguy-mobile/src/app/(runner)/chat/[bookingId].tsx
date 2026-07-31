import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
  AppState,
  Animated,
  type AppStateStatus,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ChatImage } from '../../../components/chat/ChatImage';
import { useLocalSearchParams } from 'expo-router';
import { Send, Camera, Phone, Check, CheckCheck, Clock, AlertCircle, RotateCw, ArrowDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useChat } from '../../../hooks/useChat';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { useKeyboard } from '../../../hooks/useKeyboard';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { ErrorState } from '../../../components/ui/ErrorState';
import { ChatThreadSkeleton } from '../../../components/ui/Skeleton';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { ImageLightbox } from '../../../components/ui/ImageLightbox';
import { Spinner } from '../../../components/ui/Spinner';
import { LightColors, Elevation } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import { formatTime } from '../../../utils/formatDate';
import { buildChatRows, type ChatRow } from '../../../utils/chatList';
import { resolveImageUrl } from '../../../utils/resolveImageUrl';
import { RUNNER_QUICK_MESSAGES } from '../../../constants/quickMessages';
import type { Message } from '../../../types';
import { toast } from '../../../stores/toastStore';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';

/**
 * One row in the local (screen-level) inverted chat list. Message rows
 * carry grouping flags (same sender, < 5 min apart, no separator in
 * between) so bursts render as one visual block: tail corner + meta
 * row only on the group end, tighter spacing inside the group.
 */
type Row =
  | { kind: 'msg'; message: Message; groupStart: boolean; groupEnd: boolean }
  | { kind: 'day'; id: string; label: string };

// Messages from the same sender within this window collapse into one
// visual group (the iMessage/WhatsApp idiom).
const GROUP_WINDOW_MS = 5 * 60 * 1000;

// Any non-msg neighbour (day pill, list edge) breaks a group, which
// also guarantees groups never straddle a day boundary.
function inSameGroup(a: ChatRow, b: ChatRow | undefined): boolean {
  if (!b || a.kind !== 'msg' || b.kind !== 'msg') return false;
  if (a.message.is_system || b.message.is_system) return false;
  if (a.message.sender_id !== b.message.sender_id) return false;
  return (
    Math.abs(+new Date(a.message.created_at) - +new Date(b.message.created_at)) <
    GROUP_WINDOW_MS
  );
}

// In an inverted list, contentOffset.y IS the distance from the newest
// message. Under this threshold the user counts as reading the live
// edge — read receipts stay honest and no jump chip is needed.
const NEAR_BOTTOM_PT = 200;

/**
 * Meta row under a bubble: timestamp plus (for own messages) delivery
 * state. Rendered at group ends only — except failed/pending sends,
 * which always surface their state so a mid-burst failure can't hide.
 * Failed rows are real buttons (tap to retry); everything else is
 * inert text so screen readers don't stop on a dead wrapper.
 */
function DeliveryMeta({
  message: m,
  isMe,
  onRetry,
}: {
  message: Message;
  isMe: boolean;
  onRetry: (id: string) => void;
}) {
  if (!isMe) {
    return (
      <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5 px-1">
        {formatTime(m.created_at)}
      </Text>
    );
  }
  return (
    <Pressable
      onPress={m.failed ? () => onRetry(m.id) : undefined}
      disabled={!m.failed}
      hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
      className="flex-row items-center mt-0.5 px-1"
      style={({ pressed }) => (pressed && m.failed ? { opacity: 0.6 } : undefined)}
      accessibilityRole={m.failed ? 'button' : 'text'}
      accessibilityLabel={m.failed ? 'Message failed to send. Retry' : undefined}
    >
      <Text className="text-[11px] font-montserrat text-textSecondary mr-1">
        {formatTime(m.created_at)}
      </Text>
      {m.pending ? (
        <>
          <Clock size={11} color={LightColors.textMuted} />
          <Text className="text-[11px] font-montserrat text-textSecondary ml-1">
            Sending
          </Text>
        </>
      ) : m.failed ? (
        <>
          <AlertCircle size={11} color={LightColors.dangerDark} />
          <Text className="text-[11px] font-montserrat-semi text-dangerDark ml-1">
            Failed · Tap to retry
          </Text>
          <RotateCw size={11} color={LightColors.dangerDark} style={{ marginLeft: 4 }} />
        </>
      ) : m.read_at ? (
        <>
          <CheckCheck size={12} color={LightColors.primaryDark} />
          <Text className="text-[11px] font-montserrat text-primaryDark ml-0.5">
            Read
          </Text>
        </>
      ) : (
        <>
          <Check size={12} color={LightColors.textMuted} />
          <Text className="text-[11px] font-montserrat text-textSecondary ml-0.5">
            Sent
          </Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * Floating "New message" chip shown when a message lands while the
 * user is paging through history. Tapping snaps back to the newest
 * message. Entrance fade/rise is skipped under Reduce Motion.
 */
function NewMessageChip({ onPress }: { onPress: () => void }) {
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [reduced, enter]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: 12,
        alignSelf: 'center',
        opacity: enter,
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
        ],
      }}
    >
      <Pressable
        onPress={onPress}
        // 36pt chip + 4pt vertical hitSlop = 44pt effective target.
        hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
        className="flex-row items-center bg-primary rounded-full px-4"
        style={({ pressed }) => [
          { height: 36, ...Elevation.primary },
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Scroll to newest message"
      >
        <ArrowDown size={14} color={LightColors.textInverse} />
        <Text className="text-xs font-montserrat-semi text-white ml-1.5">
          New message
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Subtle "typing…" bubble shown above the composer while the customer is
 * typing. Three dots pulse in sequence; under Reduce Motion the dots hold
 * a static dimmed state (no looping animation).
 */
function TypingIndicator() {
  const reduced = useReducedMotion();
  const d1 = useRef(new Animated.Value(0.35)).current;
  const d2 = useRef(new Animated.Value(0.35)).current;
  const d3 = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (reduced) return;
    const pulse = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.35, duration: 300, useNativeDriver: true }),
        ]),
      );
    const anim = Animated.parallel([pulse(d1, 0), pulse(d2, 150), pulse(d3, 300)]);
    anim.start();
    return () => anim.stop();
  }, [reduced, d1, d2, d3]);

  return (
    <View
      className="px-4 pb-1 items-start"
      accessibilityRole="text"
      accessibilityLabel="The customer is typing"
    >
      <View
        className="flex-row items-center bg-surface border border-divider rounded-full px-3 py-2"
        style={{ gap: 5 }}
      >
        {[d1, d2, d3].map((v, i) => (
          <Animated.View
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: LightColors.textMuted,
              opacity: reduced ? 0.6 : v,
            }}
          />
        ))}
      </View>
    </View>
  );
}

export default function RunnerChatScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);
  const currentErrand = useRunnerStore((s) => s.currentErrand);
  const insets = useSafeAreaInsets();
  const { width, mScale } = useResponsive();
  const { isVisible: keyboardVisible } = useKeyboard();
  const reducedMotion = useReducedMotion();

  const {
    messages,
    fetchMessages,
    sendMessage: chatSendMessage,
    sendMessageWithImage: chatSendImage,
    retryMessage: chatRetryMessage,
    markAsRead,
    loadOlder,
    hasMore,
    loadingOlder,
    unreadCount,
    isTyping,
    sendTyping,
  } = useChat(bookingId ?? '');

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // Initial-fetch status. `initialLoading` shows a spinner in the empty
  // slot on the very first load; `loadError` surfaces a retry affordance
  // above the composer when that first fetch fails (previously silent,
  // which showed a false "no messages" and hid dropoff instructions).
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const flatListRef = useRef<FlatList<Row>>(null);
  // (image aspect ratios now live inside <ChatImage>'s own local state, so a
  //  photo resolving no longer re-renders the whole visible message window — P12)
  // Live-edge tracking: whether the viewport is within NEAR_BOTTOM_PT of
  // the newest message. Drives receipt honesty (don't mark read what the
  // runner hasn't seen) and the floating "New message" chip.
  const nearBottomRef = useRef(true);
  const [showNewMsgChip, setShowNewMsgChip] = useState(false);

  // Customer contact — populated on the runner-facing booking payload.
  // Name titles the header; phone falls back through the contact fields
  // to the customer's account phone.
  const customerName =
    currentErrand?.id === bookingId
      ? currentErrand?.customer?.full_name ?? 'Customer'
      : 'Customer';
  const customerPhone =
    currentErrand?.id === bookingId
      ? currentErrand?.dropoff_contact_phone ??
        currentErrand?.pickup_contact_phone ??
        currentErrand?.customer?.phone ??
        null
      : null;

  const handleCallCustomer = useCallback(() => {
    if (!customerPhone) {
      toast.error('Customer phone is not available');
      return;
    }
    Linking.openURL(`tel:${customerPhone}`).catch(() =>
      toast.error('Could not start call'),
    );
  }, [customerPhone]);

  // Inverted FlatList consumes a newest-first array. Memoizing keeps the
  // `data` ref stable across unrelated re-renders so RN doesn't redo
  // the entire viewport on every parent tick. Day separators are baked
  // in here (cheap O(n) walk) so the renderer stays a pure function.
  // Grouping flags are attached last so day pills break a group.
  const rows = useMemo<Row[]>(() => {
    const base: ChatRow[] = buildChatRows(messages);
    // Newest-first array: index i-1 is the NEWER neighbour, so the
    // group END (which carries the tail corner + meta row) is the row
    // whose newer neighbour doesn't group with it.
    return base.map((r, i) =>
      r.kind === 'msg'
        ? {
            ...r,
            groupEnd: !inSameGroup(r, base[i - 1]),
            groupStart: !inSameGroup(r, base[i + 1]),
          }
        : r,
    );
  }, [messages]);

  // Fetch initial messages and mark as read
  useEffect(() => {
    if (!bookingId) return;
    setInitialLoading(true);
    setLoadError(false);
    fetchMessages()
      .then(() => setLoadError(false))
      .catch(() => setLoadError(true))
      .finally(() => setInitialLoading(false));
    // Only PATCH /read on mount when there's actually something to
    // clear, so opening an already-read thread doesn't cost a write.
    if (unreadCount > 0) {
      markAsRead().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, fetchMessages, markAsRead]);

  // Manual retry from the ErrorState shown above the composer.
  const handleReload = useCallback(() => {
    setInitialLoading(true);
    setLoadError(false);
    fetchMessages()
      .then(() => setLoadError(false))
      .catch(() => setLoadError(true))
      .finally(() => setInitialLoading(false));
  }, [fetchMessages]);

  // Auto-mark-as-read while the conversation is in the foreground so
  // the runner's unread badge clears as the customer's messages stream
  // in. Debounced 1.2s so a burst collapses into a single PATCH; gated
  // on AppState active + unreadCount > 0.
  const lastSeenLengthRef = useRef(messages.length);
  useEffect(() => {
    if (!bookingId) return;
    if (messages.length <= lastSeenLengthRef.current) {
      lastSeenLengthRef.current = messages.length;
      return;
    }
    lastSeenLengthRef.current = messages.length;

    const last = messages[messages.length - 1];
    if (!last || last.sender_id === user?.id || last.is_system) return;
    if (AppState.currentState !== 'active') return;

    // Receipt honesty: while the runner is paging through history the
    // new message is off-screen, so don't tell the customer it was
    // read — surface the jump chip instead. The read flushes when the
    // runner returns to the live edge (scroll handler / chip tap).
    if (!nearBottomRef.current) {
      setShowNewMsgChip(true);
      return;
    }
    if (unreadCount === 0) return; // nothing to clear server-side

    const handle = setTimeout(() => {
      markAsRead().catch(() => {});
    }, 1_200);
    return () => clearTimeout(handle);
  }, [bookingId, messages, user?.id, markAsRead, unreadCount]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      // Same honesty gate as the debounced path: only flush the receipt
      // if the runner is actually at the live edge of the conversation.
      if (state === 'active' && bookingId && unreadCount > 0 && nearBottomRef.current) {
        markAsRead().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [bookingId, markAsRead, unreadCount]);

  // Track the distance from the newest message. Crossing back into the
  // live edge dismisses the chip and flushes any withheld read receipt.
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const wasNear = nearBottomRef.current;
      nearBottomRef.current = e.nativeEvent.contentOffset.y < NEAR_BOTTOM_PT;
      if (!wasNear && nearBottomRef.current) {
        setShowNewMsgChip(false);
        if (unreadCount > 0) markAsRead().catch(() => {});
      }
    },
    [unreadCount, markAsRead],
  );

  const handleJumpToNewest = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setShowNewMsgChip(false);
    nearBottomRef.current = true;
    flatListRef.current?.scrollToOffset({ offset: 0, animated: !reducedMotion });
    if (unreadCount > 0) markAsRead().catch(() => {});
  }, [reducedMotion, unreadCount, markAsRead]);

  const handleSend = useCallback(
    async (content?: string, imageUrl?: string) => {
      if (!bookingId) return;
      const text = content ?? inputText.trim();
      if (!text && !imageUrl) return;

      // Clear the input BEFORE awaiting so the message appears instantly.
      // The optimistic bubble inside chatSendMessage gives the "sent"
      // feedback while the API settles. With an inverted FlatList the
      // new bubble is automatically at the visible bottom — no manual
      // scrollToEnd needed.
      if (!content) setInputText('');
      // Sending from deep in history: snap back so the outgoing bubble
      // is actually visible (the inverted list would otherwise hold the
      // scrolled-up position).
      if (!nearBottomRef.current) {
        nearBottomRef.current = true;
        setShowNewMsgChip(false);
        flatListRef.current?.scrollToOffset({ offset: 0, animated: !reducedMotion });
      }
      try {
        await chatSendMessage(text || undefined, imageUrl);
      } catch (err: any) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => {},
        );
        toast.error(errorMessage(err, copy.chat.sendFailed));
        if (!content) setInputText((prev) => (prev ? prev : text));
      }
    },
    [bookingId, inputText, chatSendMessage, reducedMotion],
  );

  const handleImageSend = useCallback(
    async (uri: string) => {
      setImagePickerVisible(false);
      if (!bookingId) return;
      setSending(true);
      try {
        // Multipart upload — the server stores the file and returns the
        // canonical URL on the message row. Sending the raw `file://` URI
        // through the JSON path would be silently dropped.
        await chatSendImage(uri);
      } catch (err: any) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
          () => {},
        );
        toast.error(errorMessage(err, copy.chat.imageSendFailed));
      } finally {
        setSending(false);
      }
    },
    [bookingId, chatSendImage],
  );

  // Retry a failed send. Light impact on the tap; an error notification
  // + toast if it fails again.
  const handleRetry = useCallback(
    (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      chatRetryMessage(id).catch(() => {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => {});
        toast.error('Still couldn’t send. Check your connection.');
      });
    },
    [chatRetryMessage],
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      // Day separator pill — sits between calendar-day boundaries the
      // same way iMessage / WhatsApp do, so the runner can scan when a
      // conversation happened without reading every timestamp.
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
      const isMe = m.sender_id === user?.id;
      const isSystem = m.is_system;

      if (isSystem) {
        return (
          <View className="items-center my-2 px-4">
            <Text className="text-xs font-montserrat italic text-textSecondary text-center">
              {m.content}
            </Text>
          </View>
        );
      }

      // Grouped bursts sit tight (2pt each side); group boundaries get
      // the full 4pt so blocks read as blocks. Timestamp + receipt only
      // on the group end — failed/pending sends always keep theirs so a
      // mid-burst failure can't hide.
      const marginClasses = `${item.groupStart ? 'mt-1' : 'mt-0.5'} ${
        item.groupEnd ? 'mb-1' : 'mb-0.5'
      }`;
      const showMeta = item.groupEnd || (isMe && (!!m.failed || !!m.pending));
      // Clamp bubbles on wide screens: 80% of a phone is fine, but on a
      // tablet an unclamped 80% yields 100+ char lines.
      const bubbleMaxWidth = Math.min(width * 0.8, 420);

      // Image-only messages render the image bare — no bubble chrome.
      // The chat-bubble wrapper exists to give text a tappable shape; an
      // image already has its own shape.
      const imageOnly = !!m.image_url && !m.content;

      if (imageOnly) {
        return (
          <View className={`px-4 ${marginClasses} ${isMe ? 'items-end' : 'items-start'}`}>
            <Pressable
              onPress={() => setPreviewUri(resolveImageUrl(m.image_url))}
              accessibilityRole="imagebutton"
              accessibilityLabel="View image full screen"
              style={({ pressed }) => [
                isMe && m.pending ? { opacity: 0.75 } : null,
                pressed && { opacity: 0.85 },
              ]}
            >
              <ChatImage
                uri={resolveImageUrl(m.image_url)!}
                width={220}
                borderRadius={16}
                minHeight={165}
                maxHeight={275}
              />
            </Pressable>
            {showMeta ? (
              <DeliveryMeta message={m} isMe={isMe} onRetry={handleRetry} />
            ) : null}
          </View>
        );
      }

      return (
        <View className={`px-4 ${marginClasses} ${isMe ? 'items-end' : 'items-start'}`}>
          <View
            className={`rounded-2xl px-4 py-2 ${
              isMe
                ? m.failed
                  ? // dangerDark (not danger): white content on #EF4444 is
                    // only ~3.76:1 — under the AA floor for <17px text.
                    `bg-dangerDark ${item.groupEnd ? 'rounded-br-sm' : ''}`
                  : `bg-primary ${item.groupEnd ? 'rounded-br-sm' : ''}`
                : `bg-surface border border-divider ${item.groupEnd ? 'rounded-bl-sm' : ''}`
            }`}
            style={[
              { maxWidth: bubbleMaxWidth },
              isMe && m.pending ? { opacity: 0.75 } : null,
            ]}
          >
            {m.image_url && (
              <Pressable
                onPress={() => setPreviewUri(resolveImageUrl(m.image_url))}
                accessibilityRole="imagebutton"
                accessibilityLabel="View image full screen"
                style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
              >
                <ChatImage
                  uri={resolveImageUrl(m.image_url)!}
                  width={192}
                  borderRadius={12}
                  minHeight={140}
                  maxHeight={240}
                  marginBottom={6}
                />
              </Pressable>
            )}
            {m.content && (
              <Text
                className={`text-base font-montserrat ${
                  isMe ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {m.content}
              </Text>
            )}
          </View>
          {showMeta ? (
            <DeliveryMeta message={m} isMe={isMe} onRetry={handleRetry} />
          ) : null}
        </View>
      );
    },
    [user?.id, handleRetry, width],
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title={customerName}
        showBack
        fallbackHref="/(runner)/(tabs)"
        flush
        trailing={
          <Pressable
            className="p-2"
            onPress={handleCallCustomer}
            disabled={!customerPhone}
            hitSlop={8}
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
            accessibilityRole="button"
            accessibilityLabel="Call customer"
            accessibilityState={{ disabled: !customerPhone }}
          >
            <Phone
              size={20}
              color={customerPhone ? LightColors.primary : LightColors.textMuted}
            />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        className="flex-1"
        // 'padding' on iOS keeps the input above the IME. On Android we
        // pass `undefined` and rely on `softwareKeyboardLayoutMode:
        // "resize"` (see app.json) — the OS shrinks our window so the
        // composer naturally floats above the keyboard. We also pad the
        // input by the bottom safe-area inset below so the gesture/nav
        // bar can't cover the send button.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // KAV measures from the screen edge, not from below the header,
        // so the offset must equal the real header height: safe-area top
        // inset + the GradientHeader title row (mScale(52) on iOS). A
        // constant can't cover this — Pro Max is 59+55≈114 while SE is
        // 20+52=72 — so compute it from live insets.
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + mScale(52) : 0}
      >
        {/* Messages — inverted FlatList. The newest row sits at index 0
            which RN paints at the visual bottom (the reading position).
            This makes auto-scroll-to-newest free, and "load older"
            becomes onEndReached with proper threshold + retain-position
            semantics. */}
        <View className="flex-1">
          <FlatList
            ref={flatListRef}
            data={rows}
            keyExtractor={(item) =>
              item.kind === 'msg' ? item.message.id : item.id
            }
            renderItem={renderRow}
            inverted
            className="flex-1"
            contentContainerStyle={{ paddingVertical: 12 }}
            maxToRenderPerBatch={15}
            windowSize={7}
            removeClippedSubviews
            initialNumToRender={20}
            // Drag-to-dismiss on iOS (the standard messaging gesture);
            // Android dismisses on drag. "handled" so the first tap on an
            // image / retry row isn't swallowed by keyboard dismissal.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            onScroll={handleScroll}
            scrollEventThrottle={32}
            // In an inverted list, onEndReached fires when the user
            // scrolls past the OLDEST visible row — i.e. up the screen.
            // That's exactly when we want to back-paginate.
            onEndReached={() => {
              if (hasMore && !loadingOlder) loadOlder().catch(() => {});
            }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingOlder ? (
                <View className="py-3 items-center">
                  <Spinner size="small" color={LightColors.primary} />
                </View>
              ) : null
            }
            // ListEmptyComponent is rendered inside the inverted transform,
            // so counter-flip it (scaleY:-1) or the text paints upside down.
            ListEmptyComponent={
              initialLoading ? (
                // Full-width bubble skeleton (counter-flip the inverted list
                // so the rows read top-down); replaces the bare spinner.
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
                      Say hello — messages about this errand appear here.
                    </Text>
                  )}
                </View>
              )
            }
          />
          {/* Floating jump-to-newest chip — appears when a message lands
              while the runner is reading history. */}
          {showNewMsgChip ? <NewMessageChip onPress={handleJumpToNewest} /> : null}
        </View>

        {/* First-load failure — retry sits just above the composer so the
            conversation isn't a silent blank (a false "no messages", which
            would hide dropoff instructions) when the fetch fails. */}
        {loadError && messages.length === 0 ? (
          <View className="px-4 py-2">
            <ErrorState compact onRetry={handleReload} />
          </View>
        ) : null}

        {/* Live "typing…" indicator from the customer. */}
        {isTyping ? <TypingIndicator /> : null}

        {/* Quick Messages */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Explicit fixed height + flexShrink/flexGrow=0 so the strip
          // never stretches to fill leftover vertical space (an Android
          // flex quirk would otherwise turn each pill into a tall capsule).
          style={{ height: 46, flexGrow: 0, flexShrink: 0 }}
          className="border-t border-divider"
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 8, alignItems: 'center' }}
        >
          {RUNNER_QUICK_MESSAGES.map((msg) => (
            <Pressable
              key={msg}
              // Explicit height keeps the pill from stretching to fill
              // the ScrollView's cross-axis when a parent flex bounds it.
              // hitSlop lifts the 32pt pill to a >=44pt effective target.
              style={{ height: 32 }}
              hitSlop={{ top: 6, bottom: 6 }}
              className={`px-3 items-center justify-center rounded-full ${sending ? 'bg-surfaceMuted' : 'bg-divider'}`}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                handleSend(msg);
              }}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={`Send quick message: ${msg}`}
              accessibilityState={{ disabled: sending }}
            >
              <Text className={`text-xs font-montserrat ${sending ? 'text-textTertiary' : 'text-primary'}`}>
                {msg}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Input Area — bottom padding tracks the system inset so the
            Android gesture/nav bar never overlaps the send button. When the
            iOS keyboard is up the KeyboardAvoidingView already lifts the
            composer above it, so the home-indicator inset would only open a
            dead gap between composer and keyboard — collapse it to 8pt. */}
        <View
          className="flex-row items-end px-4 pt-3 border-t border-divider bg-surface"
          style={{
            paddingBottom:
              Platform.OS === 'ios' && keyboardVisible
                ? 8
                : Math.max(insets.bottom, 12),
          }}
        >
          <Pressable
            className="mr-2 mb-1.5"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              setImagePickerVisible(true);
            }}
            disabled={sending}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
          >
            <Camera
              size={24}
              color={sending ? LightColors.textMuted : LightColors.textSecondary}
            />
          </Pressable>
          <TextInput
            className="flex-1 bg-background border border-divider rounded-2xl px-4 py-2.5 text-base font-montserrat text-textPrimary"
            style={{ maxHeight: 120, minHeight: 40 }}
            value={inputText}
            onChangeText={(t) => {
              setInputText(t);
              // Broadcast a throttled "typing" ping to the customer.
              sendTyping();
            }}
            placeholder="Type a message..."
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
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
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

      <ImagePickerModal
        visible={imagePickerVisible}
        onClose={() => setImagePickerVisible(false)}
        onConfirm={handleImageSend}
        title="Send Photo"
        subtitle="Share a photo in the chat"
      />

      <ImageLightbox
        uri={previewUri}
        visible={previewUri !== null}
        onClose={() => setPreviewUri(null)}
      />
    </View>
  );
}
