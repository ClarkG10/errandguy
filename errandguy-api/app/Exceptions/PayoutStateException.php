<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Thrown when a payout cannot transition because it is not in the `pending`
 * state (e.g. already completed/failed). Callers translate this into a 422
 * (API) or a warning notification (Filament).
 */
class PayoutStateException extends RuntimeException
{
}
