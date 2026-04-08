<?php

namespace App\Policies;

use App\Models\RunnerProfile;
use App\Models\User;

class RunnerProfilePolicy
{
    public function update(User $user, RunnerProfile $profile): bool
    {
        return $user->id === $profile->user_id;
    }
}
