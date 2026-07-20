<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class IdempotencyKey extends Model
{
    use HasUuids;

    protected $keyType = 'string';
    public $incrementing = false;

    protected $fillable = [
        'user_id',
        'idem_key',
        'method',
        'path',
        'request_hash',
        'status',
        'response_code',
        'response_body',
        'locked_at',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'response_body' => 'array',
            'response_code' => 'integer',
            'locked_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }
}
