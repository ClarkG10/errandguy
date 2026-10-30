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
