<?php

namespace App\Policies;

use App\Models\SavedAddress;
use App\Models\User;

class SavedAddressPolicy
{
    public function delete(User $user, SavedAddress $address): bool
    {
        return $user->id === $address->user_id;
    }
}
