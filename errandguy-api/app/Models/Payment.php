<?php

namespace App\Models;

use App\Enums\PaymentStatus;
use App\Exceptions\InvalidStatusTransitionException;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Payment extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'booking_id',
        'customer_id',
        'amount',
        'currency',
        'method',
        'status',
        'gateway_tx_id',
        'gateway_response',
        'paid_at',
        'refund_amount',
        'refunded_at',
        'refunded_to',
    ];

    protected $hidden = [
        'gateway_response',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'refund_amount' => 'decimal:2',
            'gateway_response' => 'array',
            'paid_at' => 'datetime',
            'refunded_at' => 'datetime',
        ];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function transitions(): HasMany
    {
        return $this->hasMany(PaymentStatusTransition::class)->orderBy('created_at');
    }

    /**
     * The single funnel for changing a payment's status. Validates the move
     * against {@see PaymentStatus::allowed()}, applies it together with any
     * side-column updates (e.g. paid_at, refund_amount, gateway_response), and
     * writes an immutable row to `payment_status_transitions`.
     *
     * NEVER call ->update(['status' => ...]) directly — that bypasses the
     * guard and the audit log.
     *
     * Idempotent: transitioning to the CURRENT status is a no-op and returns
     * false (no audit row). An illegal move throws — callers that legitimately
     * see out-of-order events (e.g. webhook handlers) must guard on
     * isTerminal() BEFORE calling.
     *
     * Must run inside the caller's DB transaction when a row lock is in play
     * (webhook handlers already provide one) — it does not open its own.
     *
     * @param  array<string,mixed>  $meta   Extra context recorded on the audit row.
     * @param  array<string,mixed>  $extra  Additional payment columns to update.
     */
    public function transitionTo(
        PaymentStatus $to,
        string $actor = 'system',
        ?string $reason = null,
        array $meta = [],
        array $extra = [],
    ): bool {
        $from = $this->status;

        // No-op: already there. Do NOT re-apply `extra` — a replayed webhook
        // must not clobber the original paid_at / gateway_response. Callers
        // that see out-of-order events guard with canTransitionTo() before
        // calling, so this branch is the last line of idempotency defense.
        if ($from === $to->value) {
            return false;
        }

        $current = PaymentStatus::tryFrom((string) $from);
        if ($current !== null && ! $current->canTransitionTo($to)) {
            throw InvalidStatusTransitionException::for('payment', $from, $to->value);
        }

        $this->update(array_merge($extra, ['status' => $to->value]));

        PaymentStatusTransition::create([
            'payment_id' => $this->id,
            'from_status' => $from,
            'to_status' => $to->value,
            'actor' => $actor,
            'reason' => $reason,
            'meta' => empty($meta) ? null : $meta,
            'created_at' => now(),
        ]);

        return true;
    }

    public function scopeCompleted($query)
    {
        return $query->where('status', 'completed');
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }
}
