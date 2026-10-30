<?php

namespace App\Models;

use App\Services\CacheService;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Cache;

class ErrandType extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    /**
     * Retired slug → the kept type that now covers it (launch catalog, 2026-10).
     *
     * Runners' preferred types were remapped the same way by
     * 2026_10_30_000001_simplify_errand_catalog, so an errand booked before the
     * retirement but not yet taken (a scheduled food run, say) is still offered
     * to the runners who now pick "Buy for me". bills_payment and
     * transportation have no successor: no runner prefers them any more, so an
     * unstarted one goes unmatched and ends through the normal no-runner path.
     */
    public const RETIRED_SUCCESSORS = [
        'document' => 'delivery',
        'laundry' => 'delivery',
        'food' => 'purchase',
        'grocery' => 'purchase',
    ];

    /**
     * Retired types with no code left behind them (rides lost their PIN and
     * step ladder, bills their creation flow). They stay off for good: the
     * rows exist only so old bookings still show their type.
     */
    public const REMOVED_SLUGS = ['bills_payment', 'transportation'];

    protected static function booted(): void
    {
        static::saving(function (ErrandType $type) {
            if (in_array($type->slug, self::REMOVED_SLUGS, true)) {
                $type->is_active = false;
            }
        });

        // The app's catalog is cached; drop it so a staff price or switch
        // change reaches the app at once instead of up to an hour later.
        $forget = fn () => Cache::forget(CacheService::errandTypesKey());
        static::saved($forget);
        static::deleted($forget);
    }

    protected $fillable = [
        'slug',
        'name',
        'description',
        'icon_name',
        'base_fee',
        'per_km_walk',
        'per_km_bicycle',
        'per_km_motorcycle',
        'per_km_car',
        'surcharge',
        'is_active',
        'sort_order',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'base_fee' => 'decimal:2',
            'per_km_walk' => 'decimal:2',
            'per_km_bicycle' => 'decimal:2',
            'per_km_motorcycle' => 'decimal:2',
            'per_km_car' => 'decimal:2',
            'surcharge' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }

    /** The slug to look for in a runner's preferred_types for an errand of this slug. */
    public static function preferenceSlug(string $slug): string
    {
        return self::RETIRED_SUCCESSORS[$slug] ?? $slug;
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    public function scopeOrdered($query)
    {
        return $query->orderBy('sort_order');
    }
}
