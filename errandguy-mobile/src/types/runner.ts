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
  documents?: RunnerDocument[];
}

/**
 * What the shift just ended amounted to, returned by PUT /runner/online when
 * going offline.
 *
 * `null` from the server means "we can't measure this honestly" (no recorded
 * shift start) — render nothing rather than a zeroed card that reads like a
 * bad day.
 *
 * `earnings` is payout ONLY; `tips` is reported alongside and is never folded
 * in, matching the earnings screen and the PDF statement. The two must agree —
 * runner_payout is what the cash-settlement commission maths reconciles
 * against.
 */
export interface ShiftSummary {
  started_at: string;
  ended_at: string;
  minutes_online: number;
  errands: number;
  earnings: number;
  tips: number;
}

export interface RunnerDocument {
  id: string;
  runner_id: string;
  document_type: DocumentType;
  /** Legacy public URL; NULL for new private-disk docs — prefer download_url. */
  file_url: string | null;
  /** Auth-gated stream route for the private doc; load it with the bearer
   *  (see mediaSource). Always present from the API. */
  download_url: string;
  status: DocumentStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
