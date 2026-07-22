import type { Message, User } from '@prisma/client';
import { iso } from '../../common/serialization';

type MessageWithSender = Message & { sender?: Pick<User, 'id' | 'fullName' | 'avatarUrl'> | null };

/** Mirrors MessageResource. `sender` only when the relation is loaded. */
export function messageResource(m: MessageWithSender): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: m.id,
    booking_id: m.bookingId,
    sender_id: m.senderId,
    content: m.content,
    image_url: m.imageUrl,
    is_system: m.isSystem,
    read_at: iso(m.readAt),
    created_at: iso(m.createdAt),
  };
  if (m.sender) {
    out.sender = { id: m.sender.id, full_name: m.sender.fullName, avatar_url: m.sender.avatarUrl };
  }
  return out;
}
