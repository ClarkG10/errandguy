<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WalletTransaction extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'type',
        'amount',
        'bonus_portion',
        'balance_after',
        'reference_id',
        'booking_id',
        'gateway_ref',
        'checkout_url',
        'payout_destination',
        'description',
        'status',
        'processed_at',
        'payout_sent_at',
        'failure_reason',
        'initiated_by_staff_id',
    ];

    // The gateway reference (Xendit internal id) is a gateway internal that the
    // client never needs; the wallet-ledger list endpoint returns raw models, so
    // hide it from serialization. Callers that genuinely need it read the
    // property directly (unaffected by $hidden). (audit security)
    //
    // payout_destination carries a full account number, so it never
    // serializes either; the ledger shows the masked label in
    // display_description instead. Which staff member made a hand-made
    // adjustment or payout is for the admin panel only.
    protected $hidden = [
        'gateway_ref',
        'payout_destination',
        'initiated_by_staff_id',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'bonus_portion' => 'decimal:2',
            'balance_after' => 'decimal:2',
            'created_at' => 'datetime',
            'processed_at' => 'datetime',
            'payout_sent_at' => 'datetime',
            // {channel, channel_code, account_number, account_name, bank_name}
            // — see App\Support\PayoutDestination.
            'payout_destination' => 'encrypted:array',
        ];
    }

    /**
     * A payout handed to Xendit: it has a Xendit id, or the send started and
     * its answer never came back. Either way the money may already be on its
     * way, so only Xendit can say it failed (WalletService::failPayout).
     */
    public function isSentToGateway(): bool
    {
        return filled($this->gateway_ref) || $this->payout_sent_at !== null;
    }

    /**
     * The errand a gateway tip charge ('tip_payment') is for. Each charge has
     * its own row keyed by booking_id; rows from before that carry the errand
     * in reference_id.
     */
    public function tipBookingId(): ?string
    {
        return $this->booking_id ?? $this->reference_id;
    }

    /**
     * Attributes appended to JSON output. Letting these flow through the
     * API saves the mobile client from re-implementing the same humanise
     * logic for both customer and runner wallet screens.
     */
    protected $appends = ['display_description'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** The staff member who moved this money by hand (adjustment or payout), if any. */
    public function initiatedByStaff(): BelongsTo
    {
        return $this->belongsTo(AdminUser::class, 'initiated_by_staff_id');
    }

    /**
     * Booking referenced by this transaction (only meaningful for
     * payment/earning/refund types where reference_id stores a booking
     * UUID). The relation lazily resolves to null otherwise.
     */
    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class, 'reference_id');
    }

    /**
     * Customer-facing description.
     *
     * The raw `description` column was historically written as terse
     * dev-strings ("Payment for booking 7f3c-...", "Wallet top-up").
     * That made the wallet ledger feel auto-generated and leaked UUIDs.
     *
     * This accessor produces a friendlier label using the related
     * Booking + ErrandType when available, falling back to the
     * existing description when nothing better can be derived. We do
     * NOT mutate the stored column so historical audit trails stay
     * intact; the original is still exposed as `description`.
     *
     * No "ErrandGuy · " prefix: every row in the ledger is ErrandGuy's, and on
     * the customer wallet's one-line rows the prefix pushed the errand number
     * off the end. Both the customer wallet and the runner's wallet activity
     * (components/runner/WalletActivityRow) render this text.
     */
    public function getDisplayDescriptionAttribute(): string
    {
        // Booking-linked types: enrich with errand type + booking #, but ONLY
        // when the caller eager-loaded booking.errandType. Since this accessor is
        // $appended, it serializes on EVERY WalletTransaction that goes out — a
        // per-row lazy lookup here was a latent N+1 waiting for any endpoint that
        // forgot to eager-load. Never query per row: the one client endpoint that
        // shows the enriched label eager-loads (WalletController::transactions),
        // and everything else falls through to the generic label below.
        if (in_array($this->type, ['payment', 'earning', 'refund'], true)
            && $this->reference_id
            && $this->relationLoaded('booking')) {
            $booking = $this->getRelation('booking');

            if ($booking) {
                $typeName = optional($booking->errandType)->name ?? 'Errand';
                $shortNumber = $booking->booking_number ?? substr((string) $booking->id, 0, 8);
                $verb = match ($this->type) {
                    'payment' => 'Paid for',
                    'earning' => 'Earned from',
                    'refund' => 'Refund for',
                };
                return "{$verb} {$typeName} #{$shortNumber}";
            }
        }

        return match ($this->type) {
            // Legacy: top-ups are retired, but older rows stay in the ledger.
            'top_up' => 'Wallet top-up',
            'payout' => ($this->isCustomerWithdrawal() ? 'Withdrawal to ' : 'Payout to ')
                .\App\Support\PayoutDestination::label($this->safePayoutDestination()),
            // Legacy: referral bonuses are retired; older credits stay listed.
            'bonus' => 'Promotional bonus',
            'cancel_fee' => 'Cancellation fee',
            default => $this->description ?? ucfirst(str_replace('_', ' ', (string) $this->type)),
        };
    }

    /**
     * A customer's own money going out — the app calls that "Withdraw" — as
     * opposed to a runner's payout of earnings. Told apart by the description
     * each flow writes ('Withdrawal request' from WalletController::withdraw,
     * 'Withdrawal on account deletion' from ProfileController::deleteAccount;
     * runner payouts write 'Payout …'), so the label needs no extra query.
     */
    private function isCustomerWithdrawal(): bool
    {
        return str_starts_with((string) $this->description, 'Withdrawal');
    }

    /**
     * The payout destination, or null when there is none or it can't be
     * decrypted — a label must never 500 the ledger.
     */
    private function safePayoutDestination(): ?array
    {
        try {
            return $this->payout_destination;
        } catch (\Throwable) {
            return null;
        }
    }
}
