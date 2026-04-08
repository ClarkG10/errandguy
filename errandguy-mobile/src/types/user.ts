export type UserRole = 'customer' | 'runner';

export type UserStatus = 'active' | 'suspended' | 'banned' | 'deleted';

export interface User {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  email_verified: boolean;
  phone_verified: boolean;
  default_lat: number | null;
  default_lng: number | null;
  fcm_token: string | null;
  wallet_balance: number;
  avg_rating: number;
  total_ratings: number;
  last_active_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
