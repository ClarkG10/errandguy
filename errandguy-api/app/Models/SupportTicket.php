<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class SupportTicket extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'booking_id',
        'subject',
        'category',
        'status',
        'last_message_at',
    ];

    protected function casts(): array
    {
        return [
            'last_message_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }

    public function messages(): HasMany
    {
        return $this->hasMany(SupportMessage::class, 'ticket_id');
    }

    /**
     * Newest message, for the list-row preview + unread indicator. A dedicated
     * HasOne (latestOfMany) so the ticket list can eager-load exactly one row per
     * ticket — eager-loading the whole thread per row, or a naive
     * ->with(['messages' => limit(1)]), would be wrong/expensive.
     */
    public function latestMessage(): HasOne
    {
        return $this->hasOne(SupportMessage::class, 'ticket_id')->latestOfMany('created_at');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function scopeForUser($query, string $userId)
    {
        return $query->where('user_id', $userId);
    }
}
