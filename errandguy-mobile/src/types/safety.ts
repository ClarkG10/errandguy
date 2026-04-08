export interface TrustedContact {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type SOSStatus = 'active' | 'resolved' | 'escalated';

export interface SOSAlert {
  id: string;
  booking_id: string;
  customer_id: string;
  runner_id: string;
  triggered_at: string;
  customer_lat: number | null;
  customer_lng: number | null;
  runner_lat: number | null;
  runner_lng: number | null;
  contacts_notified: string[];
  live_link_token: string | null;
  live_link_expires_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  status: SOSStatus;
  created_at: string;
}
