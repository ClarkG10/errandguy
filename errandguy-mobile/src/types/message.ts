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
  // ── Client-side delivery flags (never sent by the server) ──
  // Set to true by the optimistic-send path so the bubble can render a
  // "Sending…" indicator. Cleared when the server confirms.
  pending?: boolean;
  // Set to true if the optimistic send failed; the bubble renders a
  // "Failed · Tap to retry" affordance and keeps the original payload
  // so retry can re-issue the same request.
  failed?: boolean;
  // Original payload kept around so the retry button can re-send the
  // same message after a transient failure.
  retry_payload?: {
    content?: string;
    image_uri?: string;
  };
}

/** Inbox row returned by GET /chat/conversations. */
export interface Conversation {
  booking_id: string;
  booking_number: string | null;
  status: string;
  errand_type: { id: string; name: string; slug?: string } | null;
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
