import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useChatStore } from '../stores/chatStore';

/**
 * Mark this conversation as the one on screen while its chat screen has
 * focus, so the foreground push handler doesn't drop a banner (and a buzz) on
 * top of a message that is already appearing in the thread. Focus, not mount:
 * a chat screen left mounted under another screen is no longer being read.
 */
export function useOpenChatThread(bookingId: string | undefined): void {
  useFocusEffect(
    useCallback(() => {
      if (!bookingId) return undefined;
      useChatStore.getState().setOpenThread(bookingId);
      return () => {
        // Only clear our own claim — a second chat may already have taken it.
        if (useChatStore.getState().openThreadId === bookingId) {
          useChatStore.getState().setOpenThread(null);
        }
      };
    }, [bookingId]),
  );
}
