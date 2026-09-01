<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Crypt;

class RunnerProfile extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    /**
     * The documents a runner MUST upload before a KYC application can be
     * reviewed at all — the SINGLE source of truth for that pair on the PHP
     * side. The mobile runner gate declares the same list
     * (errandguy-mobile/src/app/(runner)/_layout.tsx REQUIRED_RUNNER_DOC_TYPES,
     * itself mirroring the `required: true` entries of REQUIRED_DOCUMENTS in
     * onboarding.tsx). If the two ever drift, an application the app considers
     * complete would be filed under "Incomplete" in the admin queue and wait
     * longer than it should — so change them together.
     */
    public const REQUIRED_DOCUMENT_TYPES = ['government_id', 'selfie'];

    protected $fillable = [
        'user_id',
        'verification_status',
        'vehicle_type',
        'vehicle_plate',
        'vehicle_photo_url',
        'is_online',
        'current_lat',
        'current_lng',
        'last_location_at',
        'acceptance_rate',
        'completion_rate',
        'total_errands',
        'total_earnings',
        'preferred_types',
        'working_area_lat',
        'working_area_lng',
        'working_area_radius',
        'bank_name',
        'bank_account_number',
        'ewallet_number',
        'payout_channel_code',
        'approved_at',
    ];

    protected $hidden = [
        'bank_account_number',
    ];

    protected function casts(): array
    {
        return [
            'is_online' => 'boolean',
            'preferred_types' => 'array',
            'total_earnings' => 'decimal:2',
            'acceptance_rate' => 'decimal:2',
            'completion_rate' => 'decimal:2',
            'current_lat' => 'decimal:7',
            'current_lng' => 'decimal:7',
            'last_location_at' => 'datetime',
            'approved_at' => 'datetime',
        ];
    }

    public function setBankAccountNumberAttribute($value): void
    {
        $this->attributes['bank_account_number'] = $value ? Crypt::encryptString($value) : null;
    }

    public function getBankAccountNumberAttribute($value): ?string
    {
        return $value ? Crypt::decryptString($value) : null;
    }

    /**
     * Last 4 digits of the saved bank account — computed at read, never stored.
     *
     * The full number is encrypted at rest and $hidden, so the payout screen's
     * account field renders empty forever and runners cannot tell whether an
     * account is already on file (they re-type it "just in case" every visit,
     * and can't spot a typo in the one they saved). This is the smallest honest
     * confirmation: "•••• 1234 on file". NOTHING wider than the last 4 digits
     * is ever exposed, and this is not $appends'd — RunnerProfileResource emits
     * it only for the owning runner.
     */
    public function getBankAccountLast4Attribute(): ?string
    {
        try {
            $number = $this->bank_account_number;
        } catch (\Throwable) {
            // A legacy row written before the Crypt setter holds plaintext and
            // throws on decrypt. Read as "nothing on file" rather than a 500.
            return null;
        }

        $digits = preg_replace('/\D/', '', (string) $number) ?? '';

        return strlen($digits) >= 4 ? substr($digits, -4) : null;
    }

    /** True when a payout could actually be sent to the saved bank details. */
    public function hasStoredBankAccountNumber(): bool
    {
        // Read the RAW column so a legacy/undecryptable value still counts as
        // "on file" (the accessor would throw / mask it as absent).
        return filled($this->getRawOriginal('bank_account_number'));
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(RunnerDocument::class, 'runner_id');
    }

    /** Errands this runner has taken (bookings.runner_id → users.id → this profile's user_id). */
    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class, 'runner_id', 'user_id');
    }

    public function scopeOnline($query)
    {
        return $query->where('is_online', true);
    }

    public function scopeApproved($query)
    {
        return $query->where('verification_status', 'approved');
    }

    public function scopePending($query)
    {
        return $query->where('verification_status', 'pending');
    }

    /**
     * Applications an admin can actually act on: a non-rejected document on file
     * for EVERY required type (mirrors the mobile gate's isDocComplete — a
     * rejected document doesn't count, the runner is sent back to re-upload).
     *
     * `pending` on its own is not a review queue: the profile row is created at
     * registration, before a single upload, so the emptiest applications are
     * also the oldest and permanently head-block an oldest-first list. Compose
     * with pending() for "the KYC queue".
     */
    public function scopeReadyForReview($query)
    {
        foreach (self::REQUIRED_DOCUMENT_TYPES as $type) {
            $query->whereHas('documents', fn ($documents) => $documents
                ->where('document_type', $type)
                ->where('status', '!=', 'rejected'));
        }

        return $query;
    }

    /**
     * The exact complement of readyForReview(): at least one required document
     * is still missing (or was rejected and not replaced). Kept as its own scope
     * so the "Incomplete" bucket stays visible with its own count — nothing
     * disappears from the admin, it just stops blocking the review queue.
     */
    public function scopeAwaitingDocuments($query)
    {
        return $query->where(function ($outer) {
            foreach (self::REQUIRED_DOCUMENT_TYPES as $type) {
                $outer->orWhereDoesntHave('documents', fn ($documents) => $documents
                    ->where('document_type', $type)
                    ->where('status', '!=', 'rejected'));
            }
        });
    }

    /**
     * documents_count plus a count per review status, so the admin list can show
     * a "Docs" cell ("2 uploaded · 1 pending") and a reviewable row is
     * distinguishable from a dead one without opening it.
     *
     * required_documents_count is a row count over the required types; the
     * uploader keeps at most one row per type, so "== count(REQUIRED_DOCUMENT_TYPES)"
     * means complete. It drives display only — readyForReview() above does the
     * exact per-type check that filing decisions rest on.
     */
    public function scopeWithDocumentCounts($query)
    {
        return $query->withCount([
            'documents',
            'documents as documents_pending_count' => fn ($documents) => $documents
                ->where('status', 'pending'),
            'documents as documents_rejected_count' => fn ($documents) => $documents
                ->where('status', 'rejected'),
            'documents as required_documents_count' => fn ($documents) => $documents
                ->whereIn('document_type', self::REQUIRED_DOCUMENT_TYPES)
                ->where('status', '!=', 'rejected'),
        ]);
    }
}
