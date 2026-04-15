<?php

namespace App\Policies;

use App\Models\SavedAddress;
use App\Models\User;

class SavedAddressPolicy
{
    public function update(User $user, SavedAddress $address): bool
    {
        return $user->id === $address->user_id;
    }

    public function delete(User $user, SavedAddress $address): bool
    {
        return $user->id === $address->user_id;
    }
}
