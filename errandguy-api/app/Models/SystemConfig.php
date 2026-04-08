<?php

namespace App\Models;

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

        Cache::forget("system_config:{$key}");
        Cache::forget('app_config');
    }
}
