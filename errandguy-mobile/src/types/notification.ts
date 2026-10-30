export type NotificationType =
  | 'booking_update'
  | 'payment'
  | 'system'
  | 'sos'
  | 'chat'
  | 'document_update'
  // Live progress ticks from the runner (shopping checklist / extra stops).
  // Their real consumer is the tracking screen, which patches itself straight
  // from the payload — but the rows also land in the inbox, so they must be
  // typed, categorised and tappable like everything else.
  | 'shopping_items_updated'
  | 'booking_stops_updated'
  // Reminder that a runner's application is still unfinished
  // (errandguy:send-onboarding-reminders). Routes to the document screen like
  // document_update; it needs its own type so the SERVER can read its own
  // send cadence off the notifications table.
  | 'onboarding_reminder';

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
