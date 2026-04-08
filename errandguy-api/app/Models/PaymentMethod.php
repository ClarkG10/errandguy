<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PaymentMethod extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;
    public $timestamps = false;

    protected $fillable = [
        'user_id',
        'type',
        'label',
        'gateway_token',
        'is_default',
        'last_four',
        'card_brand',
        'expires_at',
    ];

    protected $hidden = [
        'gateway_token',
    ];

    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'expires_at' => 'date',
            'created_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
