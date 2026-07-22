import { iso } from '../../common/serialization';

/** Sender shape loaded via `sender:id,full_name,avatar_url`. */
export type SupportSender = { id: string; fullName: string; avatarUrl: string | null };

/**
 * Input shape for {@link supportMessageResource}. Superset-compatible with the
 * Prisma `SupportMessage` row; `sender` is present only when the relation was
 * loaded (mirrors Laravel `whenLoaded('sender')`).
 */
export type SupportMessageInput = {
  id: string;
  ticketId: string;
  senderId: string | null;
  senderType: string;
  content: string;
  imageUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
  sender?: SupportSender | null;
};

/**
 * Input shape for {@link supportTicketResource}. Superset-compatible with the
 * Prisma `SupportTicket` row; `messages` is present only when the relation was
 * loaded (mirrors Laravel `whenLoaded('messages')`).
 */
export type SupportTicketInput = {
  id: string;
  userId: string;
  bookingId: string | null;
  subject: string;
  category: string;
  status: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  messages?: SupportMessageInput[];
};

/** Mirrors SupportMessageResource. `sender` only emitted when the relation is loaded. */
export function supportMessageResource(m: SupportMessageInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: m.id,
    ticket_id: m.ticketId,
    sender_id: m.senderId,
    sender_type: m.senderType,
  };
  if (m.sender !== undefined) {
    out.sender = m.sender
      ? { id: m.sender.id, full_name: m.sender.fullName, avatar_url: m.sender.avatarUrl }
      : null;
  }
  out.content = m.content;
  out.image_url = m.imageUrl;
  out.read_at = iso(m.readAt);
  out.created_at = iso(m.createdAt);
  return out;
}

/** Mirrors SupportTicketResource. `messages`/`latest_message` only when loaded. */
export function supportTicketResource(t: SupportTicketInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: t.id,
    user_id: t.userId,
    booking_id: t.bookingId,
    subject: t.subject,
    category: t.category,
    status: t.status,
    last_message_at: iso(t.lastMessageAt),
    created_at: iso(t.createdAt),
  };
  if (t.messages !== undefined) {
    out.messages = t.messages.map(supportMessageResource);
    // Laravel: latest_message only when the collection is non-empty.
    if (t.messages.length > 0) {
      out.latest_message = supportMessageResource(t.messages[t.messages.length - 1]);
    }
  }
  return out;
}
