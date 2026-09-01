<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class DisputeTicket extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'booking_id',
        'reported_by',
        'category',
        'description',
        'evidence_urls',
        'status',
        'resolution',
        'resolved_by',
        'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'evidence_urls' => 'array',
            'resolved_at' => 'datetime',
        ];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reported_by');
    }

    /**
     * The admin who resolved it. NOTE the asymmetry with reporter(): resolved_by
     * holds an ADMIN_USERS id (written by the panel's resolve action and by the
     * admin REST API), while reported_by holds a USERS id — pointing this at
     * User would render blank on every historic dispute. The column is nullable
     * and carries no FK, so an id whose admin has since been deleted resolves to
     * null; every render site keeps a placeholder for that.
     */
    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(AdminUser::class, 'resolved_by');
    }

    /**
     * Completed payments on the SAME booking (payments.booking_id ==
     * dispute_tickets.booking_id — the dispute itself has no payment). Exists so
     * the list query can answer "is there money to refund?" with one
     * withExists() subselect instead of a Payment lookup per row.
     */
    public function completedPayments(): HasMany
    {
        return $this->hasMany(Payment::class, 'booking_id', 'booking_id')
            ->where('payments.status', 'completed');
    }

    /**
     * Completed payments the platform can ACTUALLY refund. Cash is settled
     * runner-to-customer, so PaymentService::refundToWallet throws on it; the
     * refund action's gate uses this same predicate, or the panel would offer a
     * button that can only fail.
     */
    public function refundablePayments(): HasMany
    {
        return $this->completedPayments()->where('payments.method', '!=', 'cash');
    }

    /**
     * The settled charge behind this dispute — the row the refund action would
     * act on. `latest()` + HasOne means the eager load fetches one ordered set
     * for the whole page and matches the newest row per dispute (matchOne takes
     * the first), so the Amount/Paid-via facts cost ONE query for the list, not
     * one per row.
     */
    public function completedPayment(): HasOne
    {
        return $this->hasOne(Payment::class, 'booking_id', 'booking_id')
            ->where('payments.status', 'completed')
            ->latest('created_at');
    }

    public function scopeOpen($query)
    {
        return $query->where('status', 'open');
    }

    public function scopeReviewing($query)
    {
        return $query->where('status', 'reviewing');
    }

    /**
     * Disputes still needing admin attention — every non-terminal status
     * (resolved is the only terminal one). Single source of truth for the
     * "active"/needs-attention count so the API dashboard, the ops ActionQueue,
     * and the nav badge agree. Previously each used a different, incomplete set
     * ([open,escalated] vs [open,reviewing]), so escalated disputes — the urgent,
     * explicitly-escalated ones — were invisible in the ops queue and badge.
     */
    public function scopeUnresolved($query)
    {
        return $query->whereIn('status', ['open', 'reviewing', 'escalated']);
    }
}
