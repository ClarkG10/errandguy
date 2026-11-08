<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** An Expo push ticket awaiting its receipt (see errandguy:check-push-receipts). */
class PushTicket extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['ticket_id', 'token', 'created_at'];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
