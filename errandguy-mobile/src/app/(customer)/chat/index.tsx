import React from 'react';
import { ConversationList } from '../../../components/chat/ConversationList';

export default function CustomerChatInbox() {
  return (
    <ConversationList
      chatHrefPrefix="/(customer)/chat"
      fallbackHref="/(customer)/(tabs)/activity"
    />
  );
}
