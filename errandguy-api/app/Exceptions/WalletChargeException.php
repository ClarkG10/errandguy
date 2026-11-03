<?php

namespace App\Exceptions;

use App\Support\ErrorCode;
use RuntimeException;

/**
 * A wallet charge (a booking paid from the wallet, or a tip) refused for a
 * reason the customer should hear, with the error code to send. Thrown by
 * WalletService::deduct and ::tip before any money moves.
 *
 * Callers catch THIS, not \RuntimeException: a database error is a
 * RuntimeException too, and the broad catch used to report a dropped
 * connection as "insufficient wallet balance", with the SQL as the message.
 * Anything else now reaches ApiExceptionRenderer as an honest server error.
 */
class WalletChargeException extends RuntimeException
{
    private function __construct(string $message, public readonly ErrorCode $errorCode)
    {
        parent::__construct($message);
    }

    public static function insufficientBalance(string $message = 'Insufficient wallet balance.'): self
    {
        return new self($message, ErrorCode::INSUFFICIENT_WALLET_BALANCE);
    }

    public static function alreadyTipped(): self
    {
        return new self('This errand has already been tipped.', ErrorCode::CONFLICT);
    }

    /** The runner's (or customer's) account is gone, so there is nobody to pay. */
    public static function nobodyToTip(): self
    {
        return new self('This errand’s runner can’t receive tips any more.', ErrorCode::BOOKING_STATE_INVALID);
    }
}
