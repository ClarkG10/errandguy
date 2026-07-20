<?php

namespace App\Enums;

/**
 * Canonical lifecycle of a Payment (a single gateway charge / settlement).
 *
 * These are the ONLY legal values for `payments.status`, and the ONLY legal
 * moves between them are declared in {@see self::allowed()}. Every mutation
 * must go through {@see \App\Models\Payment::transitionTo()} so the move is
 * validated and written to the `payment_status_transitions` audit log — never
 * `->update(['status' => ...])` directly.
 *
 * The app can only report what the gateway/backend has actually confirmed, so
 * there is no fabricated "authorizing"/"bank authorization" state — hosted
 * checkout happens inside Xendit and surfaces to us as pending → processing →
 * a terminal outcome via webhook.
 */
enum PaymentStatus: string
{
    case Pending = 'pending';        // created, nothing collected yet (cash sits here)
    case Processing = 'processing';  // handed off to the gateway, awaiting settlement
    case Completed = 'completed';    // gateway confirmed the money moved
    case Failed = 'failed';          // gateway declined / charge failed
    case Expired = 'expired';        // invoice/checkout expired before payment
    case Cancelled = 'cancelled';    // abandoned before settlement
    case Refunded = 'refunded';      // a completed charge was refunded

    /**
     * Allowed forward transitions. Anything not listed is illegal and will
     * throw {@see \App\Exceptions\InvalidStatusTransitionException}. A move to
     * the SAME status is treated as an idempotent no-op by transitionTo() and
     * is not represented here.
     *
     * @return array<string, list<string>>
     */
    public static function allowed(): array
    {
        return [
            self::Pending->value => [
                self::Processing->value,
                self::Completed->value,
                self::Failed->value,
                self::Expired->value,
                self::Cancelled->value,
            ],
            self::Processing->value => [
                self::Completed->value,
                self::Failed->value,
                self::Expired->value,
                self::Cancelled->value,
            ],
            self::Completed->value => [
                self::Refunded->value,
            ],
            // Terminal states — no outgoing transitions.
            self::Failed->value => [],
            self::Expired->value => [],
            self::Cancelled->value => [],
            self::Refunded->value => [],
        ];
    }

    public function isTerminal(): bool
    {
        return empty(self::allowed()[$this->value] ?? []);
    }

    public function canTransitionTo(self $to): bool
    {
        return in_array($to->value, self::allowed()[$this->value] ?? [], true);
    }
}
