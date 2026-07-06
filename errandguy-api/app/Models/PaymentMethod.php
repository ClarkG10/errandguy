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
        'status',
        'label',
        'gateway_token',
        'gateway_ref',
        'is_default',
        'last_four',
        'card_brand',
        'channel_code',
        'expires_at',
    ];

    protected $hidden = [
        'gateway_token',
        'gateway_ref',
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
