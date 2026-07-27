<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Thrown when a booking cannot transition because of its current state
 * (e.g. already completed/cancelled). Callers translate this into a 422
 * (API) or a warning notification (Filament).
 */
class BookingStateException extends RuntimeException
{
}
