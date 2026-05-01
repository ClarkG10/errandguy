import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { ArrowLeft, Send, Camera, Phone } from 'lucide-react-native';
import { ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useBookingStore } from '../../../stores/bookingStore';
import { useChat } from '../../../hooks/useChat';
import { Avatar } from '../../../components/ui/Avatar';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { formatTime } from '../../../utils/formatDate';
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
    markAsRead,
    loadOlder,
    hasMore,
    loadingOlder,
  } = useChat(bookingId ?? '');

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);

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
    markAsRead().catch(() => {});
  }, [bookingId, fetchMessages, markAsRead]);

  // Keep the read receipt fresh while the user is actively looking at
  // the conversation. Without this, every Realtime push from the runner
  // bumped the global unread badge even though the message was visible
  // on screen — the user would have to leave and come back to clear it.
  //
  // Conditions:
  //   - app must be foregrounded (AppState === 'active')
  //   - newest message must NOT be from us (otherwise nothing new to read)
  //   - debounced via the dependency on `messages.length` so a burst of
  //     incoming messages collapses into a single PATCH.
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
    markAsRead().catch(() => {});
  }, [bookingId, messages, user?.id, markAsRead]);

  // When the user returns to the app with the chat already open, flush
  // a read receipt so the unread badge clears immediately.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && bookingId) {
        markAsRead().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [bookingId, markAsRead]);

  const handleSend = useCallback(
    async (content?: string, imageUrl?: string) => {
      if (!bookingId) return;
      const text = content ?? inputText.trim();
      if (!text && !imageUrl) return;

      // Clear the input + scroll BEFORE awaiting so the message appears
      // instantly. The optimistic bubble inside chatSendMessage gives
      // the "sent" feedback while the API settles in the background.
      if (!content) setInputText('');
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 30);
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
      flatListRef.current?.scrollToEnd({ animated: true });
    } catch {
      toast.error('Failed to send image');
    } finally {
      setSending(false);
    }
  }, [bookingId, chatSendImage]);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => {
      const isMe = item.sender_id === user?.id;
      const isSystem = item.is_system;

      if (isSystem) {
        return (
          <View className="items-center my-2 px-4">
            <Text className="text-xs font-montserrat italic text-textSecondary text-center">
              {item.content}
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
              isMe ? 'bg-primary rounded-br-sm' : 'bg-divider rounded-bl-sm'
            }`}
          >
            {item.image_url && (
              <Image
                source={{ uri: item.image_url }}
                className="w-48 h-48 rounded-lg mb-1"
                contentFit="cover"
              />
            )}
            {item.content && (
              <Text
                className={`text-sm font-montserrat ${
                  isMe ? 'text-white' : 'text-textPrimary'
                }`}
              >
                {item.content}
              </Text>
            )}
            <Text
              className={`text-[10px] font-montserrat mt-1 ${
                isMe ? 'text-white/60' : 'text-textSecondary'
              }`}
            >
              {formatTime(item.created_at)}
            </Text>
          </View>
        </View>
      );
    },
    [user?.id],
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
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          className="flex-1"
          contentContainerStyle={{ paddingVertical: 12 }}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews={true}
          // Older messages live ABOVE the current top — trigger the
          // back-pagination when the user scrolls near the start of the
          // list. iOS reports negative offsets at the top, so any
          // y < 60 means "close to the start".
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
                  Pull down or scroll up to load older messages
                </Text>
              </View>
            ) : null
          }
          onContentSizeChange={() => {
            // Only auto-scroll-to-end when NEW messages arrive at the
            // bottom. If we're prepending older messages from a back-fetch
            // (loadingOlder), preserve the user's current scroll position
            // \u2014 jumping them to the bottom would defeat the whole point
            // of pagination.
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
    </SafeAreaView>
  );
}
