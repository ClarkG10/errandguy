<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
