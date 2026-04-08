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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Send } from 'lucide-react-native';
import { useAuthStore } from '../../../stores/authStore';
import { RUNNER_QUICK_MESSAGES } from '../../../constants/quickMessages';
import type { Message } from '../../../types';

export default function RunnerChatScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const user = useAuthStore((s) => s.user);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const flatListRef = useRef<FlatList<Message>>(null);

  // TODO: Replace with real-time messaging (WebSocket/Pusher) in Phase 9
  useEffect(() => {
    // Fetch initial messages
  }, [bookingId]);

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    const newMessage: Message = {
      id: Date.now().toString(),
      booking_id: bookingId ?? '',
      sender_id: user?.id ?? '',
      content: input.trim(),
      image_url: null,
      is_system: false,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMessage]);
    setInput('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [input, bookingId, user]);

  const handleQuickMessage = useCallback(
    (msg: string) => {
      setInput(msg);
    },
    [],
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
        <Pressable onPress={() => router.back()}>
          <ArrowLeft size={24} color="#0F172A" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-base font-montserrat-bold text-textPrimary">
            Chat with Customer
          </Text>
          <Text className="text-xs font-montserrat text-textSecondary">
            Booking #{bookingId?.slice(0, 8)}
          </Text>
        </View>
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
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
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
              className="bg-primaryLight px-3 py-1.5 rounded-full mr-2"
            >
              <Text className="text-xs font-montserrat text-primary">{msg}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Input */}
        <View className="flex-row items-center gap-2 px-5 py-3 pb-6 border-t border-divider bg-background">
          <TextInput
            className="flex-1 bg-surface border border-divider rounded-full px-4 py-2.5 text-sm font-montserrat text-textPrimary"
            placeholder="Type a message..."
            placeholderTextColor="#94A3B8"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <Pressable
            onPress={handleSend}
            className={`w-10 h-10 rounded-full items-center justify-center ${
              input.trim() ? 'bg-primary' : 'bg-gray-200'
            }`}
            disabled={!input.trim()}
          >
            <Send size={18} color={input.trim() ? '#FFFFFF' : '#94A3B8'} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
