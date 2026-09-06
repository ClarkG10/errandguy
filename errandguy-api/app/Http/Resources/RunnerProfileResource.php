<?php

namespace App\Http\Resources;

use App\Models\SystemConfig;
use App\Support\CashDebtPolicy;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RunnerProfileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // The runner's bank/e-wallet, earnings, GPS coordinates and
        // working area are private financial / location data. They must
        // never appear in a nested response served to a customer (e.g.
        // BookingResource->runner->runner_profile).
        $isSelf = $request->user()?->id === $this->user_id;

        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'verification_status' => $this->verification_status,
            'vehicle_type' => $this->vehicle_type,
            'vehicle_plate' => $this->vehicle_plate,
            'vehicle_photo_url' => $this->vehicle_photo_url,
            'is_online' => $this->is_online,
            // Coarse GPS only matters to the owning runner; the live
            // tracking on the customer's tracking screen pulls from
            // RunnerLocation, not from the cached profile column.
            'current_lat' => $this->when($isSelf, $this->current_lat),
            'current_lng' => $this->when($isSelf, $this->current_lng),
            'last_location_at' => $this->when($isSelf, $this->last_location_at),
            'acceptance_rate' => $this->acceptance_rate,
            'completion_rate' => $this->completion_rate,
            'total_errands' => $this->total_errands,
            'total_earnings' => $this->when($isSelf, $this->total_earnings),
            'preferred_types' => $this->when($isSelf, $this->preferred_types),
            'working_area_lat' => $this->when($isSelf, $this->working_area_lat),
            'working_area_lng' => $this->when($isSelf, $this->working_area_lng),
            'working_area_radius' => $this->when($isSelf, $this->working_area_radius),
            'bank_name' => $this->when($isSelf, $this->bank_name),
            // Masked proof that an account IS on file. bank_account_number is
            // encrypted + $hidden, so the payout screen's account field is
            // blank forever and runners re-enter it every visit; the last 4
            // digits are computed at read and never stored (see the model
            // accessor). Closure so a non-self serialization never decrypts.
            'bank_account_last4' => $this->when($isSelf, fn (): ?string => $this->bank_account_last4),
            'ewallet_number' => $this->when($isSelf, $this->ewallet_number),
            // The payout floor the Request button is really gated on. The app
            // hardcoded ₱100 while the server reads min_payout_amount from
            // SystemConfig — an admin raising it silently broke the client's
            // "you can cash out" maths. (SystemConfig::getValue is cached 1h.)
            'payout_minimum' => $this->when(
                $isSelf,
                fn (): float => (float) SystemConfig::getValue('min_payout_amount', '100'),
            ),
            // Why the offer feed is short. Over the cash-debt ceiling, CASH
            // errands are filtered out of the pull feed AND out of dispatch AND
            // refused at accept — so without this the runner just watches work
            // stop appearing and blames the app. Rides the profile payload (like
            // payout_minimum above) so it reaches every runner surface through
            // plumbing that already exists, including the /runner/home
            // aggregate. null when solvent, so the client renders nothing in the
            // normal case.
            //
            // Reads the balance off `$request->user()`, NOT `$this->user`: this
            // key only renders when $isSelf, which means the authenticated user
            // IS this profile's owner, so the relation would be a second trip to
            // the same row. Going through the relation instead made the payload
            // silently depend on the caller eager-loading `user` — `show()` did,
            // `update()` and the nested UserResource on /me did not, so those
            // paths lazy-loaded one extra query each.
            'cash_debt_block' => $this->when($isSelf, function () use ($request): ?array {
                $balance = (float) ($request->user()?->wallet_balance ?? 0);
                if (! CashDebtPolicy::blocks($balance)) {
                    return null;
                }

                return [
                    'owed' => round(abs($balance), 2),
                    'limit' => CashDebtPolicy::limit(),
                    'message' => CashDebtPolicy::message($balance),
                ];
            }),
            'approved_at' => $this->approved_at,
            // Drives the runner's "Member since" on the profile tab (and is a
            // harmless trust signal for customers). Without it the mobile read
            // was always undefined → every runner showed "New member".
            'created_at' => $this->created_at,
            'documents' => $this->when(
                $isSelf && $this->relationLoaded('documents'),
                fn () => RunnerDocumentResource::collection($this->documents),
            ),
        ];
    }
}
