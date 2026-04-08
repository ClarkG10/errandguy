export type NotificationType =
  | 'booking_update'
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
