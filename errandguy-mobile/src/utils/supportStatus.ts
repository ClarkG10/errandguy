import type { SupportMessage, SupportTicketStatus } from '../services/support.service';

export type SupportStatusVariant = 'soft' | 'warning' | 'success' | 'neutral';

/**
 * A support ticket's status, from the person's point of view.
 *
 * The server's `pending` means "an agent replied, the ball is with the user"
 * (an agent reply flips the ticket to it) — the inbox used to call that
 * "Awaiting reply", which read as "we haven't answered you yet" on exactly the
 * tickets we HAD answered. And when the user writes back, the server leaves
 * the status at `pending` (App\Models\SupportTicket::scopeNeedsReply), so the
 * status alone can't say whose turn it is: the newest message can. System
 * notes don't count as anyone's turn.
 */
export function supportStatusLabel(
  status: SupportTicketStatus,
  lastSender?: SupportMessage['sender_type'] | null,
): { label: string; variant: SupportStatusVariant } {
  if (status === 'resolved') return { label: 'Resolved', variant: 'success' };
  if (status === 'closed') return { label: 'Closed', variant: 'neutral' };
  const weReplied =
    lastSender === 'agent' || (lastSender !== 'user' && status === 'pending');
  return weReplied
    ? { label: 'We replied', variant: 'warning' }
    : { label: 'Waiting for our team', variant: 'soft' };
}

/** Who wrote the newest non-system message in a thread (oldest → newest). */
export function lastSupportSender(
  messages: ReadonlyArray<Pick<SupportMessage, 'sender_type'>>,
): SupportMessage['sender_type'] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const sender = messages[i].sender_type;
    if (sender !== 'system') return sender;
  }
  return null;
}
