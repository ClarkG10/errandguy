import React from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { Check, CheckCheck } from 'lucide-react-native';
import { Avatar } from './Avatar';
import type { Message } from '../../types';

interface ChatBubbleProps {
  message: Message;
  isMine: boolean;
  showAvatar?: boolean;
}

export function ChatBubble({
  message,
  isMine,
  showAvatar = false,
}: ChatBubbleProps) {
  if (message.is_system) {
    return (
      <View className="py-2 px-4">
        <Text className="text-xs text-textSecondary font-montserrat text-center italic">
          {message.content}
        </Text>
      </View>
    );
  }

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View
      className={`flex-row mb-2 ${isMine ? 'justify-end' : 'justify-start'}`}
    >
      {!isMine && showAvatar && (
        <View className="mr-2 self-end">
          <Avatar size="sm" name="R" />
        </View>
      )}
      <View
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isMine ? 'bg-primary rounded-br-sm' : 'bg-divider rounded-bl-sm'
        }`}
      >
        {message.image_url && (
          <Image
            source={{ uri: message.image_url }}
            className="w-48 h-48 rounded-xl mb-2"
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        )}
        {message.content && (
          <Text
            className={`text-sm font-montserrat ${
              isMine ? 'text-white' : 'text-textPrimary'
            }`}
          >
            {message.content}
          </Text>
        )}
        <View className={`flex-row items-center mt-1 ${isMine ? 'justify-end' : ''}`}>
          <Text
            className={`text-[10px] font-montserrat ${
              isMine ? 'text-white/70' : 'text-textSecondary'
            }`}
          >
            {time}
          </Text>
          {isMine && (
            <View className="ml-1">
              {message.read_at ? (
                <CheckCheck size={14} color="#DBEAFE" />
              ) : (
                <Check size={14} color="#DBEAFE" />
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
