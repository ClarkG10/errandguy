<?php

namespace App\Services\Sms;

use App\Support\PhilippinePhone;

/**
 * What an SMS send really did: the numbers the provider ACCEPTED for delivery
 * (normalised to 09XXXXXXXXX), and an error when the whole send failed or was
 * never attempted. A number missing from `accepted` was not texted.
 */
final class SmsResult
{
    /**
     * @param  array<int,string>  $accepted  normalised numbers the provider accepted
     */
    public function __construct(
        public readonly array $accepted = [],
        public readonly ?string $error = null,
    ) {}

    public static function failed(string $error): self
    {
        return new self([], $error);
    }

    /** Whether this number (any accepted format) was accepted for delivery. */
    public function wasAccepted(?string $number): bool
    {
        $normalised = PhilippinePhone::normalize($number);

        return $normalised !== null && in_array($normalised, $this->accepted, true);
    }
}
