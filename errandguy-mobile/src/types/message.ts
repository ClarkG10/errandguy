export interface MessageSender {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

export interface Message {
  id: string;
  booking_id: string;
  sender_id: string;
  sender?: MessageSender;
  content: string | null;
  image_url: string | null;
  is_system: boolean;
  read_at: string | null;
  created_at: string;
}

/** Inbox row returned by GET /chat/conversations. */
export interface Conversation {
  booking_id: string;
  booking_number: string | null;
  status: string;
  errand_type: { id: string; name: string } | null;
  counterparty: {
    id: string;
    full_name: string;
    avatar_url: string | null;
  } | null;
  last_message: {
    preview: string | null;
    is_image: boolean;
    is_system: boolean;
    is_outgoing: boolean;
    created_at: string | null;
  } | null;
  unread_count: number;
}
