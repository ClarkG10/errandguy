export interface Coordinate {
  lat: number;
  lng: number;
}

export interface SavedAddress {
  id: string;
  user_id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  is_default: boolean;
  created_at: string;
}

export interface RunnerLocation {
  id: string;
  booking_id: string | null;
  runner_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  created_at: string;
}
