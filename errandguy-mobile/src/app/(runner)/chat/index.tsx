import React from 'react';
import { ConversationList } from '../../../components/chat/ConversationList';

export default function RunnerChatInbox() {
  return (
    <ConversationList
      chatHrefPrefix="/(runner)/chat"
      fallbackHref="/(runner)/(tabs)/history"
    />
  );
}
