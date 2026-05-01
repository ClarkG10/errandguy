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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Send, Camera, Phone } from 'lucide-react-native';
import { BackButton } from '../../../components/ui/BackButton';
import { useAuthStore } from '../../../stores/authStore';
import { useRunnerStore } from '../../../stores/runnerStore';
import { useChat } from '../../../hooks/useChat';
import { ImagePickerModal } from '../../../components/ui/ImagePickerModal';
import { RUNNER_QUICK_MESSAGES } from '../../../constants/quickMessages';
import type { Message } from '../../../types';
import { toast } from '../../../stores/toastStore';

export default function RunnerChatScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);
  const currentErrand = useRunnerStore((s) => s.currentErrand);

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
    markAsRead,
    loadOlder,
    hasMore,
    loadingOlder,
  } = useChat(bookingId ?? '');

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);

  // Fetch initial messages and mark as read
  useEffect(() => {
    if (!bookingId) return;
    fetchMessages().catch(() => {});
    markAsRead().catch(() => {});
  }, [bookingId, fetchMessages, markAsRead]);

  // Auto-mark-as-read while the conversation is in the foreground so
  // the runner's unread badge clears as the customer's messages stream
  // in. See customer chat for full rationale — same pattern, mirrored.
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

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && bookingId) {
        markAsRead().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [bookingId, markAsRead]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await chatSendMessage(input.trim());
      setInput('');
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  }, [input, sending, chatSendMessage]);

  const handleQuickMessage = useCallback(
    async (msg: string) => {
      setSending(true);
      try {
        await chatSendMessage(msg);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      } catch {
        toast.error('Failed to send message');
      } finally {
        setSending(false);
      }
    },
    [chatSendMessage],
  );

  const handleImageSend = useCallback(async (uri: string) => {
    setImagePickerVisible(false);
    setSending(true);
    try {
      await chatSendMessage(undefined, uri);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      toast.error('Failed to send image');
    } finally {
      setSending(false);
    }
  }, [chatSendMessage]);

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
              isMine ? 'bg-primary rounded-br-sm' : 'bg-surface border border-divider rounded-bl-sm'
            }`}
          >
            <Text
              className={`text-sm font-montserrat ${
                isMine ? 'text-white' : 'text-textPrimary'
              }`}
            >
              {item.content}
            </Text>
          </View>
          <Text className="text-[10px] font-montserrat text-textSecondary mt-0.5 px-1">
            {new Date(item.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      );
    },
    [user],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4 border-b border-divider">
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
          className="border-t border-divider"
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
        >
          {RUNNER_QUICK_MESSAGES.map((msg) => (
            <Pressable
              key={msg}
              onPress={() => handleQuickMessage(msg)}
              disabled={sending}
              className={`px-3 py-1.5 rounded-full mr-2 ${sending ? 'bg-gray-100' : 'bg-primaryLight'}`}
            >
              <Text className={`text-xs font-montserrat ${sending ? 'text-textTertiary' : 'text-primary'}`}>{msg}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Input */}
        <View className="flex-row items-end gap-2 px-5 py-3 pb-6 border-t border-divider bg-background">
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
            className="flex-1 bg-surface border border-divider rounded-3xl px-4 py-2.5 text-sm font-montserrat text-textPrimary"
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
    </SafeAreaView>
  );
}
