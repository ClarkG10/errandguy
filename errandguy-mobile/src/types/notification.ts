export type NotificationType =
  | 'booking_update'
  // A broadcast/negotiate job OFFER fanned out to nearby runners (not yet
  // theirs). Distinct from 'booking_update' so its tap routes to the runner's
  // offers home instead of the owner-only errand cockpit (which 404s). (RT-4)
  | 'incoming_request'
  | 'payment'
  | 'promo'
  // Referral reward credited to the wallet. A real backend notification type —
  // omitting it made referral rows fall back to the generic "system" icon/label
  // and stop routing on tap.
  | 'referral'
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
