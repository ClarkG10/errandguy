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

  const {
    messages,
    fetchMessages,
    sendMessage: chatSendMessage,
    markAsRead,
  } = useChat(bookingId ?? '');

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const flatListRef = useRef<FlatList<Message>>(null);

  // Fetch initial messages and mark as read
  useEffect(() => {
    if (!bookingId) return;
    fetchMessages().catch(() => {});
    markAsRead().catch(() => {});
  }, [bookingId, fetchMessages, markAsRead]);

  const handleSend = useCallback(
    async (content?: string, imageUrl?: string) => {
      if (!bookingId) return;
      const text = content ?? inputText.trim();
      if (!text && !imageUrl) return;

      setSending(true);
      try {
        await chatSendMessage(text || undefined, imageUrl);
        setInputText('');
        flatListRef.current?.scrollToEnd({ animated: true });
      } catch {
        toast.error('Failed to send message');
      } finally {
        setSending(false);
      }
    },
    [bookingId, inputText, chatSendMessage],
  );

  const handleImageSend = useCallback(async (uri: string) => {
    setImagePickerVisible(false);
    await handleSend(undefined, uri);
  }, [handleSend]);

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
          className="mr-3 w-9 h-9 rounded-xl bg-surface items-center justify-center"
          style={{ shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 }}
        >
          <ArrowLeft size={20} color="#0F172A" />
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
          <Pressable className="mr-2" onPress={() => setImagePickerVisible(true)}>
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
