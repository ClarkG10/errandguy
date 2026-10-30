<?php

namespace App\Support;

use App\Models\SystemConfig;

/**
 * How much unsettled platform commission a runner may owe before we stop
 * handing them CASH work.
 *
 * WHY THIS EXISTS. On a cash errand the runner collects the whole fare in
 * person and keeps their payout, so the platform's commission is taken by
 * DEBITING their wallet (see BookingSettlementService::settleCompletion). Nothing
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
     * The one message for a runner who owes money from cash errands — the
     * accept refusal, the profile's cash_debt_block, a payout request and an
     * account-deletion refusal all say exactly this, so the runner hears one
     * consistent story: how much, how it clears, and when cash work pauses.
     */
    public static function message(float $walletBalance): string
    {
        $owed = number_format(abs(round($walletBalance, 2)), 2);
        $message = "You owe ₱{$owed} from cash errands. It’s cleared automatically from your next prepaid earnings";

        if (! self::enabled()) {
            return $message.'.';
        }

        $limit = self::limit();

        return $message.'; cash errands pause at ₱'.number_format($limit, fmod($limit, 1.0) == 0.0 ? 0 : 2).'.';
    }
}
