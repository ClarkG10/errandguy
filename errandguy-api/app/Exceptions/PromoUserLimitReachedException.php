<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Thrown when a per-user promo slot cannot be claimed because the user is at
 * their per_user_limit — checked atomically under the per-(user,promo) lock at
 * booking-create time (so a concurrent second booking that raced past the
 * advisory validate() check is rejected). Caught in BookingController::store and
 * surfaced as a clean PROMO_INVALID 422.
 */
class PromoUserLimitReachedException extends RuntimeException
{
}
