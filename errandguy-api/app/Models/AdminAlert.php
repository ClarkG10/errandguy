<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;

/**
 * A single operator alert shown in the /admin "Live alerts" feed. Raised on
 * time-critical events (SOS, unmatched errand, a stalled or over-running
 * errand) and dismissed by operators.
 */
class AdminAlert extends Model
{
    use HasUuids;

    protected $keyType = 'string';

    public $incrementing = false;

    protected $fillable = [
        'type',
        'severity',
        'title',
        'body',
        'subject_id',
        'read_at',
    ];

    protected function casts(): array
    {
        return ['read_at' => 'datetime'];
    }

    /**
     * Raise an operator alert. Best-effort — a failed insert (e.g. the table
     * isn't migrated on this environment yet) must NEVER break the caller's
     * flow (SOS triggering, runner matching).
     *
     * @param  string       $type      sos | no_runner | stalled_errand | ride_duration | dispute | …
     * @param  string       $severity  critical | warning | info
     * @param  string|null  $subjectId related record id, for the deep-link
     */
    public static function raise(
        string $type,
        string $severity,
        string $title,
        ?string $body = null,
        ?string $subjectId = null,
    ): void {
        try {
            static::create([
                'type' => $type,
                'severity' => $severity,
                'title' => $title,
                'body' => $body,
                'subject_id' => $subjectId,
            ]);
        } catch (\Throwable $e) {
            Log::warning('AdminAlert::raise failed', ['type' => $type, 'error' => $e->getMessage()]);
        }
    }

    public function scopeUnread(Builder $query): Builder
    {
        return $query->whereNull('read_at');
    }
}
