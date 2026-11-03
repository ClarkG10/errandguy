<?php

namespace App\Models;

use App\Services\CacheService;
use App\Services\PricingService;
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

    /**
     * Bookable shopping types ("Buy for me"): the runner pays for the items and
     * the customer repays them in cash at the door. Nothing is charged online
     * for items, so what a runner can be asked to front is capped
     * (shoppingBudgetMax).
     */
    public const SHOPPING_SLUGS = ['purchase'];

    /** Default for the staff-adjustable `shopping_budget_max` setting (₱). */
    public const DEFAULT_SHOPPING_BUDGET_MAX = 3000;

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

    /**
     * The most a runner can be asked to pay for a customer's items (₱): the
     * `shopping_budget_max` setting, or the default when it is missing or not
     * a positive number.
     */
    public static function shoppingBudgetMax(): float
    {
        $value = SystemConfig::getValue('shopping_budget_max', (string) self::DEFAULT_SHOPPING_BUDGET_MAX);

        return is_numeric($value) && (float) $value > 0
            ? round((float) $value, 2)
            : (float) self::DEFAULT_SHOPPING_BUDGET_MAX;
    }

    /**
     * The bookable catalog the app reads (/errand-types and the customer home
     * screen): active types in order, each carrying `minimum_price` (the
     * app's "From ₱X") and each shopping type `shopping_budget_max` so the app
     * can show and enforce the cap.
     *
     * @return list<array<string, mixed>>
     */
    public static function catalog(): array
    {
        $budgetMax = self::shoppingBudgetMax();

        return self::where('is_active', true)
            ->orderBy('sort_order')
            ->get()
            ->map(function (self $type) use ($budgetMax): array {
                $row = [...$type->toArray(), 'minimum_price' => $type->minimumPrice()];

                return in_array($type->slug, self::SHOPPING_SLUGS, true)
                    ? [...$row, 'shopping_budget_max' => $budgetMax]
                    : $row;
            })
            ->all();
    }

    /**
     * The least a booking of this type can cost (₱): PricingService's own
     * total on the cheapest vehicle the type offers, at 0 km — base fee,
     * vehicle premium, service fee (platform_fee_percent) and surcharge. The
     * app showed the base fee alone as "From ₱X", which left out the service
     * fee every booking pays.
     */
    public function minimumPrice(): float
    {
        $estimates = app(PricingService::class)->estimate($this->id, 0.0, 0.0, null, null);

        $totals = array_map(
            fn (string $vehicle): float => (float) $estimates[$vehicle]['total_amount'],
            $estimates['vehicle_types'] ?? [],
        );

        return $totals === [] ? (float) $this->base_fee : min($totals);
    }

    /** The slug to look for in a runner's preferred_types for an errand of this slug. */
    public static function preferenceSlug(string $slug): string
    {
        return self::RETIRED_SUCCESSORS[$slug] ?? $slug;
    }

    /**
     * The type to book for an errand_type_id a request names: a retired type
     * that was merged into a kept one (food/grocery → "Buy for me",
     * document/laundry → Delivery) becomes that type, so "Book again" on an
     * old errand in the app build already on phones books the type that
     * replaced it instead of dead-ending. Anything else comes back unchanged
     * (a removed type with no successor is refused by removedTypeMessage).
     */
    public static function bookableIdFor(mixed $id): mixed
    {
        if (! is_string($id) || $id === '') {
            return $id;
        }

        $slug = self::whereKey($id)->where('is_active', false)->value('slug');
        $successor = $slug !== null ? (self::RETIRED_SUCCESSORS[$slug] ?? null) : null;
        if ($successor === null) {
            return $id;
        }

        return self::where('slug', $successor)->where('is_active', true)->value('id') ?? $id;
    }

    /** Why a removed type (rides, bills payment) can't be booked, or null for any other id. */
    public static function removedTypeMessage(mixed $id): ?string
    {
        if (! is_string($id) || $id === '') {
            return null;
        }

        return match (self::whereKey($id)->value('slug')) {
            'transportation' => 'Rides are no longer available. Please choose another errand type.',
            'bills_payment' => 'Bills payment is no longer available. Please choose another errand type.',
            default => null,
        };
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
