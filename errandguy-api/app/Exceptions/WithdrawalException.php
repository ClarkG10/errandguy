<?php

namespace App\Exceptions;

use App\Support\CashDebtPolicy;
use App\Support\ErrorCode;
use RuntimeException;

/**
 * A withdrawal (payout request) that can't be queued, with the copy to show
 * and the error code to send. Thrown by WalletService::createPendingPayout,
 * before any money moves.
 */
class WithdrawalException extends RuntimeException
{
    private function __construct(string $message, public readonly ErrorCode $errorCode)
    {
        parent::__construct($message);
    }

    public static function belowMinimum(float $minimum): self
    {
        return new self(
            'The minimum payout is ₱'.number_format($minimum, 2).'. Please request at least that amount.',
            ErrorCode::PAYOUT_MIN_AMOUNT,
        );
    }

    /**
     * Asking for more than the withdrawable balance. A balance at or below zero
     * is cash-errand debt, which gets the one shared debt message instead.
     */
    public static function insufficient(float $requested, float $balance): self
    {
        if ($balance < 0) {
            return new self(CashDebtPolicy::message($balance), ErrorCode::CASH_DEBT_OUTSTANDING);
        }

        return new self(
            'You requested ₱'.number_format($requested, 2).' but your available balance is ₱'
                .number_format($balance, 2).'. Lower the amount and try again.',
            ErrorCode::INSUFFICIENT_WALLET_BALANCE,
        );
    }

    public static function invalidAmount(): self
    {
        return new self('Enter an amount greater than ₱0.', ErrorCode::VALIDATION_FAILED);
    }
}
