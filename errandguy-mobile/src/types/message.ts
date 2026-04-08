export interface MessageSender {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

export interface Message {
  id: string;
  booking_id: string;
  sender_id: string;
  sender?: MessageSender;
  content: string | null;
  image_url: string | null;
  is_system: boolean;
  read_at: string | null;
  created_at: string;
}
