<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Thrown when code attempts an illegal payment-status transition (one not
 * declared in {@see \App\Enums\PaymentStatus::allowed()}). This is a
 * programming/logic error or an out-of-order event the caller failed to guard
 * against — never a normal control-flow path — so it surfaces as a 500 and is
 * logged, rather than being silently swallowed.
 */
class InvalidStatusTransitionException extends RuntimeException
{
    public static function for(string $subject, ?string $from, string $to): self
    {
        return new self("Illegal {$subject} status transition: {$from} → {$to}.");
    }
}
