export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'resubmit';

export type VehicleType = 'walk' | 'bicycle' | 'motorcycle' | 'car';

export type DocumentType =
  | 'government_id'
  | 'selfie'
  | 'vehicle_registration'
  | 'vehicle_photo'
  | 'drivers_license';

export type DocumentStatus = 'pending' | 'approved' | 'rejected';

export interface RunnerProfile {
  id: string;
  user_id: string;
  verification_status: VerificationStatus;
  vehicle_type: VehicleType | null;
  vehicle_plate: string | null;
  vehicle_photo_url: string | null;
  is_online: boolean;
  current_lat: number | null;
  current_lng: number | null;
  last_location_at: string | null;
  acceptance_rate: number;
  completion_rate: number;
  total_errands: number;
  total_earnings: number;
  preferred_types: string[];
  working_area_lat: number | null;
  working_area_lng: number | null;
  working_area_radius: number;
  bank_name: string | null;
  bank_account_number: string | null;
  ewallet_number: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunnerDocument {
  id: string;
  runner_id: string;
  document_type: DocumentType;
  file_url: string;
  status: DocumentStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
