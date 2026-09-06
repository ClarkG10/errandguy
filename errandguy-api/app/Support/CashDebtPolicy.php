<?php

namespace App\Support;

use App\Models\SystemConfig;

/**
 * How much unsettled platform commission a runner may owe before we stop
 * handing them CASH work.
 *
 * WHY THIS EXISTS. On a cash errand the runner collects the whole fare in
 * person and keeps their payout, so the platform's commission is taken by
 * DEBITING their wallet (see RunnerErrandController::handleCompletion). Nothing
 * makes that balance non-negative and nothing stopped an indebted runner taking
 * more cash work, so a runner could collect cash indefinitely, drive their
 * balance arbitrarily negative, and simply stop using the app. The debt is real
 * money the platform never receives, and cash is expected to be the dominant
 * method in this market.
 *
 * The ceiling is deliberately a floor on the BALANCE, not a separate ledger: the
 * wallet balance already is the net of earnings credited and commission debited,
 * so a runner can always work their way back above the line with prepaid/wallet
 * errands (which CREDIT them) — the block never traps someone with no way out.
 *
 * One shared helper, used by both the dispatcher (so we don't offer cash work
 * that will be refused) and the accept guard (the authoritative check, taken
 * under the runner's row lock). Keeping them in one place is the point: a
 * dispatcher that disagrees with the guard produces offers that always fail.
 */
class CashDebtPolicy
{
    /**
     * Ceiling in PHP, from the `runner_cash_debt_limit` SystemConfig lever.
     * 0 (or negative) disables the block entirely.
     */
    public static function limit(): float
    {
        return (float) SystemConfig::getValue('runner_cash_debt_limit', '1000');
    }

    /** Is the block switched on at all? */
    public static function enabled(): bool
    {
        return self::limit() > 0;
    }

    /**
     * True when this balance is too far in debt to take on more cash work.
     *
     * Compared with `<= -limit` so the configured number is the last balance
     * still allowed to work: at a ₱1,000 limit a runner owing exactly ₱1,000 is
     * blocked, and one owing ₱999.99 is not.
     */
    public static function blocks(float $walletBalance): bool
    {
        return self::enabled() && round($walletBalance, 2) <= -self::limit();
    }

    /**
     * What the runner is told, with the exact amount they need to settle to get
     * back to work — a bare "you're blocked" leaves them with no next step.
     */
    public static function message(float $walletBalance): string
    {
        $owed = number_format(abs(round($walletBalance, 2)), 2);
        $toSettle = number_format(
            max(0, abs(round($walletBalance, 2)) - self::limit() + 0.01),
            2,
        );

        return "You owe ₱{$owed} in platform commission from cash errands, which is over the ₱"
            . number_format(self::limit(), 2) . " limit. Settle at least ₱{$toSettle} "
            . 'to take cash errands again — prepaid and wallet errands still pay you as normal.';
    }
}
