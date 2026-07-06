<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Thrown when the payment gateway (Xendit) rejects or can't fulfil a request.
 *
 * Carries the gateway's own message + error code so callers can log them and,
 * when APP_DEBUG is on, surface the real reason (e.g. "The API key is
 * forbidden…", "channel not activated", "XENDIT_SECRET_KEY is empty") instead
 * of a generic error — which is what makes these failures diagnosable.
 */
class PaymentGatewayException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly ?string $gatewayMessage = null,
        public readonly ?string $gatewayCode = null,
    ) {
        parent::__construct($message);
    }

    /** A short, human-readable reason for logs / debug responses. */
    public function reason(): string
    {
        $parts = array_filter([
            $this->gatewayMessage,
            $this->gatewayCode ? "({$this->gatewayCode})" : null,
        ]);

        return $parts ? implode(' ', $parts) : $this->getMessage();
    }
}
