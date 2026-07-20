<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Append-only audit record of a single payment status change. Written by
 * {@see Payment::transitionTo()}. Only `created_at` is tracked — rows are
 * immutable, so there is no updated_at.
 */
class PaymentStatusTransition extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = [
        'payment_id',
        'from_status',
        'to_status',
        'actor',
        'reason',
        'meta',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'meta' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class);
    }
}
