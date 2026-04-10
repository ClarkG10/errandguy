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
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send, Camera, Phone } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../stores/authStore';
import { useChatStore } from '../../../stores/chatStore';
import { chatService } from '../../../services/chat.service';
import { useImagePicker } from '../../../hooks/useImagePicker';
import { Avatar } from '../../../components/ui/Avatar';
import { formatTime } from '../../../utils/formatDate';
import { CUSTOMER_QUICK_MESSAGES } from '../../../constants/quickMessages';
import type { Message } from '../../../types';

export default function ChatScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);
  const { messages: allMessages, setMessages, addMessage } = useChatStore();
  const { pickImage } = useImagePicker();

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const messages = allMessages[bookingId ?? ''] ?? [];

  // Fetch initial messages
  useEffect(() => {
    if (!bookingId) return;

    chatService
      .getMessages(bookingId)
      .then((res) => {
        setMessages(bookingId, res.data.data ?? []);
      })
      .catch(() => {});

    chatService.markAsRead(bookingId).catch(() => {});
  }, [bookingId, setMessages]);

  // Poll for new messages (Supabase Realtime placeholder)
  useEffect(() => {
    if (!bookingId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await chatService.getMessages(bookingId);
        setMessages(bookingId, res.data.data ?? []);
        chatService.markAsRead(bookingId).catch(() => {});
      } catch {
        // Retry silently
      }
    }, 5000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [bookingId, setMessages]);

  const handleSend = useCallback(
    async (content?: string, imageUrl?: string) => {
      if (!bookingId) return;
      const text = content ?? inputText.trim();
      if (!text && !imageUrl) return;

      setSending(true);
      try {
        const res = await chatService.sendMessage(bookingId, {
          content: text || undefined,
          image_url: imageUrl,
        });
        const newMessage: Message = res.data.data;
        addMessage(bookingId, newMessage);
        setInputText('');
        flatListRef.current?.scrollToEnd({ animated: true });
      } catch {
        // Error handled silently
      } finally {
        setSending(false);
      }
    },
    [bookingId, inputText, addMessage],
  );

  const handleImageSend = useCallback(async () => {
    const result = await pickImage();
    if (result) {
      // In production: upload to Supabase Storage, get URL, then send
      await handleSend(undefined, result.uri);
    }
  }, [pickImage, handleSend]);

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
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <Avatar size="sm" />
        <Text className="text-base font-montserrat-bold text-textPrimary ml-3 flex-1">
          Runner
        </Text>
        <Pressable className="p-2">
          <Phone size={20} color="#2563EB" />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
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
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: false })
          }
        />

        {/* Quick Messages */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="border-t border-divider"
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}
        >
          {CUSTOMER_QUICK_MESSAGES.map((msg) => (
            <Pressable
              key={msg}
              className="bg-primaryLight px-3 py-1.5 rounded-full"
              onPress={() => handleSend(msg)}
            >
              <Text className="text-xs font-montserrat text-primary">
                {msg}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Input Area */}
        <View className="flex-row items-center px-4 py-3 border-t border-divider bg-surface">
          <Pressable className="mr-2" onPress={handleImageSend}>
            <Camera size={24} color="#475569" />
          </Pressable>
          <TextInput
            className="flex-1 bg-background border border-divider rounded-full px-4 h-10 text-sm font-montserrat text-textPrimary"
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#94A3B8"
            returnKeyType="send"
            onSubmitEditing={() => handleSend()}
          />
          <Pressable
            className="ml-2 w-10 h-10 rounded-full bg-primary items-center justify-center"
            onPress={() => handleSend()}
            disabled={sending || !inputText.trim()}
          >
            <Send size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
