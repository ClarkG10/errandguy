<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ErrandType extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

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
        'min_negotiate_fee',
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
            'min_negotiate_fee' => 'decimal:2',
            'created_at' => 'datetime',
        ];
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
