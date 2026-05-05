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
  type AppStateStatus,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send, Camera, Phone, Check, CheckCheck, Clock, AlertCircle, RotateCw } from 'lucide-react-native';
import { ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore } from '../../../stores/bookingStore';
import { useChat } from '../../../hooks/useChat';
import { Avatar } from '../../../components/ui/Avatar';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { ImageLightbox } from '../../../components/ui/ImageLightbox';
import { formatTime } from '../../../utils/formatDate';
import { buildChatRows, type ChatRow } from '../../../utils/chatList';
import { resolveImageUrl } from '../../../utils/resolveImageUrl';
import { CUSTOMER_QUICK_MESSAGES } from '../../../constants/quickMessages';
import type { Message } from '../../../types';
import { toast } from '../../../stores/toastStore';

export default function ChatScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);
  const activeBooking = useBookingStore((s) => s.activeBooking);
  const insets = useSafeAreaInsets();

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
  } = useChat(bookingId ?? '');

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<ChatRow>>(null);

  // Inverted FlatList consumes a newest-first array. Memoizing keeps the
  // `data` ref stable across unrelated re-renders so RN doesn't redo
  // the entire viewport on every parent tick. Day separators are baked
  // in here (cheap O(n) walk) so the renderer stays a pure function.
  const rows = useMemo<ChatRow[]>(() => buildChatRows(messages), [messages]);

  // Runner contact (only available once a runner is matched on the active booking).
  const runnerName =
    activeBooking?.id === bookingId ? activeBooking?.runner?.full_name ?? 'Runner' : 'Runner';
  const runnerPhone =
    activeBooking?.id === bookingId ? activeBooking?.runner?.phone ?? null : null;

  const handleCallRunner = useCallback(() => {
    if (!runnerPhone) {
      toast.error('Runner phone is not available yet');
      return;
    }
    Linking.openURL(`tel:${runnerPhone}`).catch(() =>
      toast.error('Could not start call'),
    );
  }, [runnerPhone]);

  // Fetch initial messages and mark as read
  useEffect(() => {
    if (!bookingId) return;
    fetchMessages().catch(() => {});
    // Only PATCH /read on mount when there's actually something to
    // clear. Previously we fired this unconditionally on every chat
    // open, costing a write on the messages table even when the
    // conversation was already fully read.
    if (unreadCount > 0) {
      markAsRead().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, fetchMessages, markAsRead]);

  // Keep the read receipt fresh while the user is actively looking at
  // the conversation. Without this, every Realtime push from the runner
  // bumped the global unread badge even though the message was visible
  // on screen — the user would have to leave and come back to clear it.
  //
  // Conditions:
  //   - app must be foregrounded (AppState === 'active')
  //   - newest message must NOT be from us (otherwise nothing new to read)
  //   - debounced 1.2s so a burst of incoming messages collapses into
  //     a single PATCH instead of one per push.
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
    if (unreadCount === 0) return; // nothing to clear server-side

    const handle = setTimeout(() => {
      markAsRead().catch(() => {});
    }, 1_200);
    return () => clearTimeout(handle);
  }, [bookingId, messages, user?.id, markAsRead, unreadCount]);

  // When the user returns to the app with the chat already open, flush
  // a read receipt so the unread badge clears immediately — but only
  // if there's actually unread content.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && bookingId && unreadCount > 0) {
        markAsRead().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [bookingId, markAsRead, unreadCount]);

  const handleSend = useCallback(
    async (content?: string, imageUrl?: string) => {
      if (!bookingId) return;
      const text = content ?? inputText.trim();
      if (!text && !imageUrl) return;

      // Clear the input BEFORE awaiting so the message appears instantly.
      // The optimistic bubble inside chatSendMessage gives the "sent"
      // feedback while the API settles in the background. With an
      // inverted FlatList the new bubble is automatically at the
      // visible bottom — no manual scrollToEnd needed (and no jank from
      // animating to a moving target while the keyboard expands).
      if (!content) setInputText('');
      try {
        await chatSendMessage(text || undefined, imageUrl);
      } catch {
        toast.error('Failed to send message');
        if (!content) setInputText((prev) => (prev ? prev : text));
      }
    },
    [bookingId, inputText, chatSendMessage],
  );

  const handleImageSend = useCallback(async (uri: string) => {
    setImagePickerVisible(false);
    if (!bookingId) return;
    setSending(true);
    try {
      // Multipart upload — the server stores the file and returns the
      // canonical URL on the message row. Sending the raw `file://` URI
      // through the JSON path would be silently dropped.
      await chatSendImage(uri);
    } catch {
      toast.error('Failed to send image');
    } finally {
      setSending(false);
    }
  }, [bookingId, chatSendImage]);

  const renderRow = useCallback(
    ({ item }: { item: ChatRow }) => {
      // Day separator pill — sits between calendar-day boundaries the
      // same way iMessage / WhatsApp do, so the user can scan when a
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

      return (
        <View
          className={`my-1 px-4 ${isMe ? 'items-end' : 'items-start'}`}
        >
          <View
            className={`max-w-[80%] rounded-2xl px-4 py-2 ${
              isMe
                ? m.failed
                  ? 'bg-danger rounded-br-sm'
                  : 'bg-primary rounded-br-sm'
                : 'bg-divider rounded-bl-sm'
            }`}
            style={isMe && m.pending ? { opacity: 0.75 } : undefined}
          >
            {m.image_url && (
              <Pressable
                onPress={() => setPreviewUri(resolveImageUrl(m.image_url))}
                accessibilityRole="imagebutton"
                accessibilityLabel="View image full screen"
              >
                <Image
                  source={{ uri: resolveImageUrl(m.image_url)! }}
                  style={{ width: 192, height: 192, borderRadius: 12, marginBottom: 6 }}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                />
              </Pressable>
            )}
            {m.content && (
              <Text
                className={`text-sm font-montserrat ${
                  isMe ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {m.content}
              </Text>
            )}
            <Text
              className={`text-[10px] font-montserrat mt-1 ${
                isMe ? 'text-white/60' : 'text-textSecondary'
              }`}
            >
              {formatTime(m.created_at)}
            </Text>
          </View>
          {/* Delivery indicator under own messages. Failed bubbles are
              tappable to retry the original payload. */}
          {isMe && (
            <Pressable
              onPress={
                m.failed
                  ? () => {
                      chatRetryMessage(m.id).catch(() =>
                        toast.error('Still couldn’t send. Check your connection.'),
                      );
                    }
                  : undefined
              }
              hitSlop={6}
              className="flex-row items-center mt-0.5 px-1"
            >
              {m.pending ? (
                <>
                  <Clock size={10} color="#94A3B8" />
                  <Text className="text-[10px] font-montserrat text-textSecondary ml-1">
                    Sending
                  </Text>
                </>
              ) : m.failed ? (
                <>
                  <AlertCircle size={11} color="#DC2626" />
                  <Text className="text-[10px] font-montserrat-semi text-danger ml-1">
                    Failed · Tap to retry
                  </Text>
                  <RotateCw size={10} color="#DC2626" style={{ marginLeft: 4 }} />
                </>
              ) : m.read_at ? (
                <>
                  <CheckCheck size={11} color="#2563EB" />
                  <Text className="text-[10px] font-montserrat text-primary ml-0.5">
                    Read
                  </Text>
                </>
              ) : (
                <>
                  <Check size={11} color="#94A3B8" />
                  <Text className="text-[10px] font-montserrat text-textSecondary ml-0.5">
                    Sent
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      );
    },
    [user?.id, chatRetryMessage],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center px-5 py-3 border-b border-divider">
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(customer)/(tabs)/activity')}
          accessibilityRole="button"
          accessibilityLabel="Back to activity"
          hitSlop={8}
          className="mr-3 w-9 h-9 rounded-xl bg-surface items-center justify-center"
          style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}
        >
          <ArrowLeft size={20} color="#0F172A" />
        </Pressable>
        <Avatar size="sm" />
        <Text className="text-base font-montserrat-bold text-textPrimary ml-3 flex-1">
          {runnerName}
        </Text>
        <Pressable
          className="p-2"
          onPress={handleCallRunner}
          disabled={!runnerPhone}
          hitSlop={8}
        >
          <Phone size={20} color={runnerPhone ? '#2563EB' : '#94A3B8'} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        // 'padding' on iOS keeps the input above the IME. On Android we
        // pass `undefined` and rely on `softwareKeyboardLayoutMode:
        // "resize"` (see app.json) — the OS shrinks our window so the
        // composer naturally floats above the keyboard. Crucially, we
        // also pad the input by the bottom safe-area inset below so the
        // gesture/nav bar can't cover the send button.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // The header above is ~56pt tall + the safe-area top inset. Without
        // an offset the input row hides BEHIND the keyboard on notched
        // iPhones because KAV measures from the screen edge, not from the
        // SafeAreaView. 90 covers the worst case (Pro Max top inset);
        // shorter devices get a few extra pts of breathing room which is
        // imperceptible but never wrong.
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Messages — inverted FlatList. The newest row sits at index 0
            which RN paints at the visual bottom (the user's reading
            position). This makes auto-scroll-to-newest free: a new
            outgoing or incoming bubble simply becomes the new index 0,
            no imperative scrollToEnd needed. The inverted layout also
            means "load older" becomes onEndReached, which RN handles
            with proper threshold + retain-position semantics, instead
            of the fragile contentOffset.y < 60 trick. */}
        <FlatList
          ref={flatListRef}
          data={rows}
          keyExtractor={(item) =>
            item.kind === 'day' ? item.id : item.message.id
          }
          renderItem={renderRow}
          inverted
          className="flex-1"
          contentContainerStyle={{ paddingVertical: 12 }}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews
          initialNumToRender={20}
          // In an inverted list, onEndReached fires when the user
          // scrolls past the OLDEST visible row — i.e. up the screen.
          // That's exactly when we want to back-paginate, with none of
          // the offset-tracking gymnastics the old top-anchored layout
          // required.
          onEndReached={() => {
            if (hasMore && !loadingOlder) loadOlder().catch(() => {});
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingOlder ? (
              <View className="py-3 items-center">
                <ActivityIndicator size="small" color="#2563EB" />
              </View>
            ) : null
          }
        />

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
          {CUSTOMER_QUICK_MESSAGES.map((msg) => (
            <Pressable
              key={msg}
              // Explicit height keeps the pill from stretching to fill
              // the ScrollView's cross-axis when a parent flex bounds it.
              style={{ height: 32 }}
              className={`px-3 items-center justify-center rounded-full ${sending ? 'bg-gray-100' : 'bg-primaryLight'}`}
              onPress={() => handleSend(msg)}
              disabled={sending}
            >
              <Text className={`text-xs font-montserrat ${sending ? 'text-textTertiary' : 'text-primary'}`}>
                {msg}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Input Area — bottom padding tracks the system inset so the
            Android gesture/nav bar never overlaps the send button. */}
        <View
          className="flex-row items-end px-4 pt-3 border-t border-divider bg-surface"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Pressable
            className="mr-2 mb-1.5"
            onPress={() => setImagePickerVisible(true)}
            disabled={sending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
          >
            <Camera size={24} color={sending ? '#94A3B8' : '#475569'} />
          </Pressable>
          <TextInput
            className="flex-1 bg-background border border-divider rounded-2xl px-4 py-2.5 text-sm font-montserrat text-textPrimary"
            style={{ maxHeight: 120, minHeight: 40 }}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#94A3B8"
            multiline
            // “Send on Enter” feels wrong on a multiline composer — leave
            // the platform's default newline behaviour and rely on the
            // dedicated send button.
            editable={!sending}
            accessibilityLabel="Message input"
          />
          <Pressable
            className={`ml-2 mb-1 w-10 h-10 rounded-full items-center justify-center ${
              sending || !inputText.trim() ? 'bg-gray-300' : 'bg-primary'
            }`}
            onPress={() => handleSend()}
            disabled={sending || !inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: sending || !inputText.trim() }}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Send size={18} color="#FFFFFF" />
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
    </SafeAreaView>
  );
}
