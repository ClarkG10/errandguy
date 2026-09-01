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

    /**
     * Tickets genuinely waiting on US: either still 'open', or non-terminal with
     * the newest message from the user.
     *
     * An agent reply flips the ticket to 'pending'; when the customer answers,
     * SupportController::postMessage bumps last_message_at but LEAVES the status
     * alone (it only re-opens a resolved/closed ticket). So a customer reply is
     * invisible in a status-only view — it sits in Pending next to tickets that
     * are genuinely awaiting the user, and the only way to tell them apart was
     * to open every pending ticket in turn. This is the predicate that separates
     * them, and it is the single source of truth for both the "Waiting on us"
     * tab and the sidebar badge, so the two can never disagree.
     *
     * COST: one correlated "who spoke last" subquery per candidate row, served
     * by idx_support_messages_ticket_created (ticket_id, created_at) as an index
     * seek + LIMIT 1 — deliberately NOT a whereHas on latestMessage(), whose
     * one-of-many join groups the whole support_messages table. The id
     * tiebreaker matters: created_at has second precision, so two messages in
     * the same second would otherwise resolve arbitrarily.
     */
    public function scopeNeedsReply($query)
    {
        $lastSender = SupportMessage::query()
            ->select('sender_type')
            ->whereColumn('support_messages.ticket_id', 'support_tickets.id')
            ->latest('created_at')
            ->latest('id')
            ->limit(1);

        return $query
            ->whereNotIn('status', ['resolved', 'closed'])
            ->where(fn ($q) => $q
                ->where('status', 'open')
                ->orWhere($lastSender, '=', 'user'));
    }
}
