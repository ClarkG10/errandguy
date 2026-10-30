<?php

namespace App\Models;

use App\Services\CacheService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

class SystemConfig extends Model
{
    protected $table = 'system_config';
    protected $primaryKey = 'key';
    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'key',
        'value',
        'description',
        'updated_by',
        'updated_at',
    ];

    /** Settings the cached /errand-types catalog is built from. */
    private const CATALOG_KEYS = ['shopping_budget_max'];

    /**
     * Staff-only settings: never sent to the app by GET /config/app (which
     * serves the rest of this table to every signed-in user). Every
     * stall_alert_* setting is staff-only too (PRIVATE_PREFIX).
     */
    public const PRIVATE_KEYS = [
        'ops_alert_emails',
        'ops_alert_phone',
        'admin_alert_email',
        'admin_alert_throttle_hours',
        'admin_adjustment_daily_cap',
        'admin_adjustment_alert_threshold',
    ];

    private const PRIVATE_PREFIX = 'stall_alert_';

    protected static function booted(): void
    {
        // Every save — staff editing a setting in the admin panel included —
        // drops the cached copies, so the change applies at once instead of up
        // to an hour later.
        $forget = function (SystemConfig $config): void {
            Cache::forget("system_config:{$config->key}");
            Cache::forget('app_config');

            if (in_array($config->key, self::CATALOG_KEYS, true)) {
                Cache::forget(CacheService::errandTypesKey());
            }
        };

        static::saved($forget);
        static::deleted($forget);
    }

    protected function casts(): array
    {
        return [
            'updated_at' => 'datetime',
        ];
    }

    /** Every setting the app may read: the whole table minus the staff-only ones. */
    public static function publicValues(): \Illuminate\Support\Collection
    {
        return static::query()
            ->whereNotIn('key', self::PRIVATE_KEYS)
            ->where('key', 'not like', self::PRIVATE_PREFIX.'%')
            ->pluck('value', 'key');
    }

    public static function getValue(string $key, $default = null): ?string
    {
        return Cache::remember("system_config:{$key}", 3600, function () use ($key, $default) {
            $config = static::find($key);
            return $config?->value ?? $default;
        });
    }

    public static function setValue(string $key, string $value, ?string $updatedBy = null): void
    {
        static::updateOrCreate(
            ['key' => $key],
            [
                'value' => $value,
                'updated_by' => $updatedBy,
                'updated_at' => now(),
            ]
        );
    }
}
