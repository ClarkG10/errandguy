import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
  ActivityIndicator,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Send, Camera, Phone, Check, CheckCheck, Clock, AlertCircle, RotateCw } from 'lucide-react-native';
import { BackButton } from '../../../components/ui/BackButton';
import { useAuthStore } from '../../../stores/authStore';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useChat } from '../../../hooks/useChat';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { ImageLightbox } from '../../../components/ui/ImageLightbox';
import { resolveImageUrl } from '../../../utils/resolveImageUrl';
import { buildChatRows, type ChatRow } from '../../../utils/chatList';
import { RUNNER_QUICK_MESSAGES } from '../../../constants/quickMessages';
import { toast } from '../../../stores/toastStore';
import { LightColors } from '../../../constants/colors';

export default function RunnerChatScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);
  const currentErrand = useRunnerStore((s) => s.currentErrand);
  const insets = useSafeAreaInsets();

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

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<ChatRow>>(null);

  // Inverted FlatList consumes a newest-first array. Memoizing keeps the
  // `data` ref stable across unrelated re-renders so RN doesn't redo
  // the entire viewport on every parent tick. Day separators are baked
  // in here (cheap O(n) walk) so the renderer stays a pure function.
  const rows = useMemo<ChatRow[]>(() => buildChatRows(messages), [messages]);

  // Fetch initial messages and mark as read (only when needed)
  useEffect(() => {
    if (!bookingId) return;
    fetchMessages().catch(() => {});
    if (unreadCount > 0) {
      markAsRead().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, fetchMessages, markAsRead]);

  // Auto-mark-as-read while the conversation is in the foreground so
  // the runner's unread badge clears as the customer's messages stream
  // in. Debounced 1.2s so a burst of incoming messages collapses into
  // a single PATCH; gated on unreadCount > 0 so we never write when
  // there's nothing to clear.
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
    if (unreadCount === 0) return;

    const handle = setTimeout(() => {
      markAsRead().catch(() => {});
    }, 1_200);
    return () => clearTimeout(handle);
  }, [bookingId, messages, user?.id, markAsRead, unreadCount]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && bookingId && unreadCount > 0) {
        markAsRead().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [bookingId, markAsRead, unreadCount]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    // Clear the input IMMEDIATELY so the runner sees their message land
    // on the same frame as the keypress. Inverted FlatList places the
    // new bubble at the visible bottom automatically — no scrollToEnd.
    setInput('');
    try {
      await chatSendMessage(text);
    } catch {
      toast.error('Failed to send message');
      setInput((prev) => (prev ? prev : text));
    }
  }, [input, sending, chatSendMessage]);

  const handleQuickMessage = useCallback(
    async (msg: string) => {
      try {
        await chatSendMessage(msg);
      } catch {
        toast.error('Failed to send message');
      }
    },
    [chatSendMessage],
  );

  const handleImageSend = useCallback(async (uri: string) => {
    setImagePickerVisible(false);
    setSending(true);
    try {
      // Multipart upload — the server stores the file and returns the
      // canonical URL on the message row. Sending the raw `file://` URI
      // through the JSON `image_url` field would 422 (must be a valid URL).
      await chatSendImage(uri);
    } catch {
      toast.error('Failed to send image');
    } finally {
      setSending(false);
    }
  }, [chatSendImage]);

  const handleRetry = useCallback(
    (id: string) => {
      chatRetryMessage(id).catch(() => {
        toast.error('Still couldn’t send. Check your connection.');
      });
    },
    [chatRetryMessage],
  );

  const renderRow = useCallback(
    ({ item }: { item: ChatRow }) => {
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
      const isMine = m.sender_id === user?.id;
      const isSystem = m.is_system;

      if (isSystem) {
        return (
          <View className="items-center my-2 px-5">
            <Text className="text-[10px] font-montserrat text-textSecondary bg-gray-100 px-3 py-1 rounded-full">
              {m.content}
            </Text>
          </View>
        );
      }

      // Image-only messages render the photo bare — no bubble chrome —
      // so the image isn't visually crammed inside a coloured pill.
      const imageOnly = !!m.image_url && !m.content;

      if (imageOnly) {
        return (
          <View className={`px-5 mb-2 ${isMine ? 'items-end' : 'items-start'}`}>
            <Pressable
              onPress={() => setPreviewUri(resolveImageUrl(m.image_url))}
              accessibilityRole="imagebutton"
              accessibilityLabel="View image full screen"
              style={isMine && m.pending ? { opacity: 0.75 } : undefined}
            >
              <Image
                source={{ uri: resolveImageUrl(m.image_url)! }}
                style={{ width: 220, height: 220, borderRadius: 16, backgroundColor: LightColors.dividerStrong }}
                contentFit="cover"
                transition={150}
                cachePolicy="memory-disk"
              />
            </Pressable>
            {isMine ? (
              <Pressable
                onPress={m.failed ? () => handleRetry(m.id) : undefined}
                hitSlop={6}
                className="flex-row items-center mt-1 px-1"
              >
                <Text className="text-[10px] font-montserrat text-textSecondary mr-1">
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                {m.pending ? (
                  <>
                    <Clock size={10} color={LightColors.textMuted} />
                    <Text className="text-[10px] font-montserrat text-textSecondary ml-1">
                      Sending
                    </Text>
                  </>
                ) : m.failed ? (
                  <>
                    <AlertCircle size={11} color={LightColors.dangerDark} />
                    <Text className="text-[10px] font-montserrat-semi text-danger ml-1">
                      Failed · Tap to retry
                    </Text>
                    <RotateCw size={10} color={LightColors.dangerDark} style={{ marginLeft: 4 }} />
                  </>
                ) : m.read_at ? (
                  <>
                    <CheckCheck size={11} color={LightColors.primary} />
                    <Text className="text-[10px] font-montserrat text-primary ml-0.5">
                      Read
                    </Text>
                  </>
                ) : (
                  <>
                    <Check size={11} color={LightColors.textMuted} />
                    <Text className="text-[10px] font-montserrat text-textSecondary ml-0.5">
                      Sent
                    </Text>
                  </>
                )}
              </Pressable>
            ) : (
              <Text className="text-[10px] font-montserrat text-textSecondary mt-1 px-1">
                {new Date(m.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>
        );
      }

      return (
        <View
          className={`px-5 mb-2 ${isMine ? 'items-end' : 'items-start'}`}
        >
          <View
            className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
              isMine
                ? m.failed
                  ? 'bg-danger rounded-br-sm'
                  : 'bg-primary rounded-br-sm'
                : 'bg-surface border border-divider rounded-bl-sm'
            }`}
            style={isMine && m.pending ? { opacity: 0.75 } : undefined}
          >
            {m.image_url ? (
              <Pressable
                onPress={() => setPreviewUri(resolveImageUrl(m.image_url))}
                accessibilityRole="imagebutton"
                accessibilityLabel="View image full screen"
              >
                <Image
                  source={{ uri: resolveImageUrl(m.image_url)! }}
                  style={{ width: 192, height: 192, borderRadius: 12, marginBottom: m.content ? 6 : 0 }}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                />
              </Pressable>
            ) : null}
            {m.content ? (
              <Text
                className={`text-sm font-montserrat ${
                  isMine ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {m.content}
              </Text>
            ) : null}
          </View>
          {/* Meta row: timestamp + delivery indicator. The indicator only
              appears on the runner's own messages; for failed sends the
              entire row becomes a tap target that retries the request. */}
          {isMine ? (
            <Pressable
              onPress={m.failed ? () => handleRetry(m.id) : undefined}
              hitSlop={6}
              className="flex-row items-center mt-0.5 px-1"
            >
              <Text className="text-[10px] font-montserrat text-textSecondary mr-1">
                {new Date(m.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              {m.pending ? (
                <>
                  <Clock size={10} color={LightColors.textMuted} />
                  <Text className="text-[10px] font-montserrat text-textSecondary ml-1">
                    Sending
                  </Text>
                </>
              ) : m.failed ? (
                <>
                  <AlertCircle size={11} color={LightColors.dangerDark} />
                  <Text className="text-[10px] font-montserrat-semi text-danger ml-1">
                    Failed · Tap to retry
                  </Text>
                  <RotateCw size={10} color={LightColors.dangerDark} style={{ marginLeft: 4 }} />
                </>
              ) : m.read_at ? (
                <>
                  <CheckCheck size={11} color={LightColors.primary} />
                  <Text className="text-[10px] font-montserrat text-primary ml-0.5">
                    Read
                  </Text>
                </>
              ) : (
                <>
                  <Check size={11} color={LightColors.textMuted} />
                  <Text className="text-[10px] font-montserrat text-textSecondary ml-0.5">
                    Sent
                  </Text>
                </>
              )}
            </Pressable>
          ) : (
            <Text className="text-[10px] font-montserrat text-textSecondary mt-0.5 px-1">
              {new Date(m.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          )}
        </View>
      );
    },
    [user, handleRetry],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-3 border-b border-divider bg-surface">
        <BackButton
          fallbackHref="/(runner)/(tabs)"
          accessibilityLabel="Back to home"
        />
        <View className="flex-1">
          <Text className="text-base font-montserrat-bold text-textPrimary">
            Chat with Customer
          </Text>
          <Text className="text-xs font-montserrat text-textSecondary">
            Booking #{bookingId?.slice(0, 8)}
          </Text>
        </View>
        <Pressable
          className="p-2"
          onPress={handleCallCustomer}
          disabled={!customerPhone}
          hitSlop={8}
        >
          <Phone size={20} color={customerPhone ? LightColors.primary : LightColors.textMuted} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        // 'padding' on iOS keeps the input above the IME without
        // shrinking the message list. On Android we deliberately use
        // `undefined` and rely on `softwareKeyboardLayoutMode: 'resize'`
        // (see app.json) PLUS the bottom safe-area padding below — this
        // avoids the system gesture bar covering the send button.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Messages — inverted FlatList. Newest row = index 0 = bottom
            of the screen. Auto-scroll to newest is automatic; older
            messages live "off screen above" and are paginated in via
            onEndReached, which RN handles with proper threshold +
            retain-position semantics. */}
        <FlatList
          ref={flatListRef}
          data={rows}
          renderItem={renderRow}
          keyExtractor={(item) =>
            item.kind === 'day' ? item.id : item.message.id
          }
          inverted
          className="flex-1"
          contentContainerStyle={{ paddingVertical: 16 }}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews
          initialNumToRender={20}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20">
              <Text className="text-sm font-montserrat text-textSecondary">
                No messages yet. Start the conversation!
              </Text>
            </View>
          }
          // In an inverted list onEndReached fires when the user
          // scrolls past the OLDEST visible row — exactly when we
          // want to back-paginate.
          onEndReached={() => {
            if (hasMore && !loadingOlder) loadOlder().catch(() => {});
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingOlder ? (
              <View className="py-3 items-center">
                <ActivityIndicator size="small" color={LightColors.primary} />
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
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' }}
        >
          {RUNNER_QUICK_MESSAGES.map((msg) => (
            <Pressable
              key={msg}
              onPress={() => handleQuickMessage(msg)}
              disabled={sending}
              // Explicit height so the pill stays a compact capsule even
              // when the surrounding ScrollView ends up taller than its
              // intrinsic content (cross-axis stretch in some Android
              // flex configurations).
              style={{ height: 32, marginRight: 8 }}
              className={`px-3 items-center justify-center rounded-full ${sending ? 'bg-gray-100' : 'bg-primaryLight'}`}
            >
              <Text className={`text-xs font-montserrat ${sending ? 'text-textTertiary' : 'text-primary'}`}>{msg}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Input — pad the bottom by the system inset so the Android
            gesture/nav bar can't sit on top of the send button. */}
        <View
          className="flex-row items-end gap-2 px-5 pt-3 border-t border-divider bg-background"
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Pressable
            onPress={() => setImagePickerVisible(true)}
            disabled={sending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
            className="mb-1.5"
          >
            <Camera size={24} color={sending ? LightColors.textMuted : LightColors.textSecondary} />
          </Pressable>
          <TextInput
            className="flex-1 bg-surface border border-divider rounded-2xl px-4 py-2.5 text-sm font-montserrat text-textPrimary"
            style={{ maxHeight: 120, minHeight: 40 }}
            placeholder="Type a message..."
            placeholderTextColor={LightColors.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
            editable={!sending}
            accessibilityLabel="Message input"
          />
          <Pressable
            onPress={handleSend}
            className={`w-10 h-10 rounded-full items-center justify-center mb-1 ${
              !input.trim() || sending ? 'bg-gray-200' : 'bg-primary'
            }`}
            disabled={!input.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !input.trim() || sending }}
          >
            {sending ? (
              <ActivityIndicator size="small" color={!input.trim() ? LightColors.textMuted : LightColors.textInverse} />
            ) : (
              <Send size={18} color={!input.trim() || sending ? LightColors.textMuted : LightColors.textInverse} />
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
