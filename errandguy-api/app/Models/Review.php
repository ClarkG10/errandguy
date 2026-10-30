<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

class Review extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'booking_id',
        'reviewer_id',
        'reviewee_id',
        'rating',
        'comment',
        'is_flagged',
    ];

    protected static function booted(): void
    {
        // A person's average follows every change to the reviews they received
        // — a new review, a deleted one, one flagged or unflagged by staff — so
        // it can never keep counting a review moderation took out.
        static::saved(function (Review $review): void {
            if ($review->wasRecentlyCreated || $review->wasChanged(['rating', 'is_flagged', 'reviewee_id'])) {
                static::refreshRatingFor($review->reviewee_id);

                if ($review->wasChanged('reviewee_id') && $review->getOriginal('reviewee_id')) {
                    static::refreshRatingFor($review->getOriginal('reviewee_id'));
                }
            }
        });

        static::deleted(function (Review $review): void {
            static::refreshRatingFor($review->reviewee_id);
        });
    }

    /**
     * Recompute a user's avg_rating / total_ratings from the reviews they
     * received, leaving out flagged ones. Locks the user row so two changes at
     * once can't each write a stale average.
     */
    public static function refreshRatingFor(?string $userId): void
    {
        if (blank($userId)) {
            return;
        }

        DB::transaction(function () use ($userId): void {
            $user = User::whereKey($userId)->lockForUpdate()->first();
            if (! $user) {
                return;
            }

            $stats = static::query()
                ->where('reviewee_id', $userId)
                ->where('is_flagged', false)
                ->selectRaw('AVG(rating) as avg_rating, COUNT(*) as total_ratings')
                ->first();

            $user->update([
                'avg_rating' => round((float) ($stats->avg_rating ?? 0), 2),
                'total_ratings' => (int) ($stats->total_ratings ?? 0),
            ]);
        });
    }

    protected function casts(): array
    {
        return [
            'rating' => 'integer',
            'is_flagged' => 'boolean',
            'created_at' => 'datetime',
        ];
    }

    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class);
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }

    public function reviewee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewee_id');
    }
}
