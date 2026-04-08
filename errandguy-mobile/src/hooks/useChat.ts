import { useEffect, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore';
import { chatService } from '../services/chat.service';
import { supabase } from '../services/supabase';
import type { Message } from '../types';

export function useChat(bookingId: string) {
  const { messages, unreadCount, isTyping, addMessage, setMessages, markRead, setIsTyping } =
    useChatStore();

  const bookingMessages = messages[bookingId] || [];

  const fetchMessages = useCallback(async () => {
    const response = await chatService.getMessages(bookingId);
    setMessages(bookingId, response.data.data);
  }, [bookingId, setMessages]);

  const sendMessage = useCallback(
    async (content?: string, image_url?: string) => {
      const response = await chatService.sendMessage(bookingId, {
        content,
        image_url,
      });
      addMessage(bookingId, response.data.data);
    },
    [bookingId, addMessage],
  );

  const markAsRead = useCallback(async () => {
    await chatService.markAsRead(bookingId);
    markRead(bookingId);
  }, [bookingId, markRead]);

  useEffect(() => {
    const channel = supabase
      .channel(`chat:${bookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          addMessage(bookingId, payload.new as Message);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, addMessage]);

  return {
    messages: bookingMessages,
    unreadCount,
    isTyping,
    fetchMessages,
    sendMessage,
    markAsRead,
    setIsTyping,
  };
}
