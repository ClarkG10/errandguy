import api from './api';
import { invalidateQuery } from '../hooks/useQuery';

// ── Types (mirror SupportTicketResource / SupportMessageResource) ──────────

export type SupportTicketStatus =
  | 'open'
  | 'pending'
  | 'resolved'
  | 'closed';

/** A single message in a support thread. `sender_type` distinguishes the
 *  customer/runner ('user') from an operator reply ('agent') or an
 *  automated 'system' note. */
export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  sender_type: 'user' | 'agent' | 'system';
  sender?: { id: string; full_name: string; avatar_url: string | null } | null;
  content: string;
  image_url: string | null;
  read_at: string | null;
  created_at: string | null;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  booking_id: string | null;
  subject: string;
  category: string;
  status: SupportTicketStatus;
  last_message_at: string | null;
  created_at: string | null;
  /** Present only on the detail (show/store) payloads. */
  messages?: SupportMessage[];
  /** Present on list payloads when the latest message is eager-loaded. */
  latest_message?: SupportMessage | null;
}

const invalidateTickets = () => {
  invalidateQuery(['support', 'tickets']);
};

export const supportService = {
  /** GET /support/tickets — the caller's own tickets, newest activity first. */
  getTickets(params?: { page?: number; per_page?: number }) {
    // Silent + short micro-cache: the list is revalidated in-place by
    // useQuery + pull-to-refresh, so the global activity bar would be noise.
    return api.get<{ data: SupportTicket[] }>('/support/tickets', {
      params,
      cacheTtlMs: 5000,
      silent: true,
    } as any);
  },

  /** POST /support/tickets — open a ticket + its first message. */
  createTicket(data: {
    subject: string;
    category: string;
    message: string;
    booking_id?: string;
  }) {
    const p = api.post<{ data: SupportTicket; message: string }>(
      '/support/tickets',
      data,
    );
    p.then(invalidateTickets).catch(() => {});
    return p;
  },

  /**
   * GET /support/tickets/{id} — ticket + a cursor page of messages.
   * `before` is an ISO-8601 cursor (a previous page's `next_before`) used
   * to page backwards into older messages, mirroring the booking chat.
   */
  getTicket(id: string, opts?: { before?: string; limit?: number }) {
    return api.get<{
      data: { ticket: SupportTicket; messages: SupportMessage[] };
      meta: { has_more: boolean; next_before: string | null };
    }>(`/support/tickets/${id}`, {
      params: {
        before: opts?.before,
        limit: opts?.limit,
      },
      silent: true,
    } as any);
  },

  /** POST /support/tickets/{id}/messages — append a reply. */
  postMessage(id: string, content: string) {
    const p = api.post<{ data: SupportMessage }>(
      `/support/tickets/${id}/messages`,
      { content },
    );
    // A new reply may re-open a resolved/closed ticket server-side and
    // bumps last_message_at, so the list order changes too.
    p.then(invalidateTickets).catch(() => {});
    return p;
  },
};
