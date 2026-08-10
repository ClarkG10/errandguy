export type NotificationType =
  | 'booking_update'
  // A broadcast/negotiate job OFFER fanned out to nearby runners (not yet
  // theirs). Distinct from 'booking_update' so its tap routes to the runner's
  // offers home instead of the owner-only errand cockpit (which 404s). (RT-4)
  | 'incoming_request'
  | 'payment'
  | 'promo'
  | 'system'
  | 'sos'
  | 'chat'
  | 'document_update';

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: NotificationType;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}
