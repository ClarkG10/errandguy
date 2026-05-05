import React, { useState, useRef, useCallback, useEffect } from 'react';
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
import { RUNNER_QUICK_MESSAGES } from '../../../constants/quickMessages';
import type { Message } from '../../../types';
import { toast } from '../../../stores/toastStore';

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
  const flatListRef = useRef<FlatList<Message>>(null);

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
    // Clear the input + scroll IMMEDIATELY so the runner sees their
    // message land in the thread on the same frame as the keypress.
    // The optimistic bubble (added inside chatSendMessage) provides the
    // "sent" feedback while the API call settles in the background.
    setInput('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 30);
    try {
      await chatSendMessage(text);
    } catch {
      toast.error('Failed to send message');
      // Restore the text so the runner can retry without retyping.
      setInput((prev) => (prev ? prev : text));
    }
  }, [input, sending, chatSendMessage]);

  const handleQuickMessage = useCallback(
    async (msg: string) => {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 30);
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
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
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

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isMine = item.sender_id === user?.id;
      const isSystem = item.is_system;

      if (isSystem) {
        return (
          <View className="items-center my-2 px-5">
            <Text className="text-[10px] font-montserrat text-textSecondary bg-gray-100 px-3 py-1 rounded-full">
              {item.content}
            </Text>
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
                ? item.failed
                  ? 'bg-danger rounded-br-sm'
                  : 'bg-primary rounded-br-sm'
                : 'bg-surface border border-divider rounded-bl-sm'
            }`}
            style={isMine && item.pending ? { opacity: 0.75 } : undefined}
          >
            {item.image_url ? (
              <Pressable
                onPress={() => setPreviewUri(resolveImageUrl(item.image_url))}
                accessibilityRole="imagebutton"
                accessibilityLabel="View image full screen"
              >
                <Image
                  source={{ uri: resolveImageUrl(item.image_url)! }}
                  style={{ width: 192, height: 192, borderRadius: 12, marginBottom: item.content ? 6 : 0 }}
                  contentFit="cover"
                  transition={150}
                  cachePolicy="memory-disk"
                />
              </Pressable>
            ) : null}
            {item.content ? (
              <Text
                className={`text-sm font-montserrat ${
                  isMine ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {item.content}
              </Text>
            ) : null}
          </View>
          {/* Meta row: timestamp + delivery indicator. The indicator only
              appears on the runner's own messages; for failed sends the
              entire row becomes a tap target that retries the request. */}
          {isMine ? (
            <Pressable
              onPress={item.failed ? () => handleRetry(item.id) : undefined}
              hitSlop={6}
              className="flex-row items-center mt-0.5 px-1"
            >
              <Text className="text-[10px] font-montserrat text-textSecondary mr-1">
                {new Date(item.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              {item.pending ? (
                <>
                  <Clock size={10} color="#94A3B8" />
                  <Text className="text-[10px] font-montserrat text-textSecondary ml-1">
                    Sending
                  </Text>
                </>
              ) : item.failed ? (
                <>
                  <AlertCircle size={11} color="#DC2626" />
                  <Text className="text-[10px] font-montserrat-semi text-danger ml-1">
                    Failed · Tap to retry
                  </Text>
                  <RotateCw size={10} color="#DC2626" style={{ marginLeft: 4 }} />
                </>
              ) : item.read_at ? (
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
          ) : (
            <Text className="text-[10px] font-montserrat text-textSecondary mt-0.5 px-1">
              {new Date(item.created_at).toLocaleTimeString([], {
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
          <Phone size={20} color={customerPhone ? '#2563EB' : '#94A3B8'} />
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
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          className="flex-1"
          contentContainerStyle={{ paddingVertical: 16 }}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews={true}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20">
              <Text className="text-sm font-montserrat text-textSecondary">
                No messages yet. Start the conversation!
              </Text>
            </View>
          }
          // Back-pagination: trigger when the user scrolls near the top.
          onScroll={(e) => {
            if (e.nativeEvent.contentOffset.y < 60 && hasMore && !loadingOlder) {
              loadOlder().catch(() => {});
            }
          }}
          scrollEventThrottle={120}
          ListHeaderComponent={
            loadingOlder ? (
              <View className="py-3 items-center">
                <ActivityIndicator size="small" color="#2563EB" />
              </View>
            ) : hasMore ? (
              <View className="py-2 items-center">
                <Text className="text-[11px] font-montserrat text-textTertiary">
                  Scroll up to load older messages
                </Text>
              </View>
            ) : null
          }
          onContentSizeChange={() => {
            // Preserve scroll position when prepending older messages.
            if (!loadingOlder) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
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
            <Camera size={24} color={sending ? '#94A3B8' : '#475569'} />
          </Pressable>
          <TextInput
            className="flex-1 bg-surface border border-divider rounded-2xl px-4 py-2.5 text-sm font-montserrat text-textPrimary"
            style={{ maxHeight: 120, minHeight: 40 }}
            placeholder="Type a message..."
            placeholderTextColor="#94A3B8"
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
              <ActivityIndicator size="small" color={!input.trim() ? '#94A3B8' : '#FFFFFF'} />
            ) : (
              <Send size={18} color={!input.trim() || sending ? '#94A3B8' : '#FFFFFF'} />
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
