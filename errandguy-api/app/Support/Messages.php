<?php

namespace App\Support;

/**
 * Single source of truth for user-facing copy, keyed by {@see ErrorCode}.
 *
 * Why a static PHP catalog and not Laravel lang files: the app is single-locale
 * today (there is no `lang/` dir), and keeping copy in PHP lets the enum and the
 * services that already own the best strings reference the same constants with
 * compile-time safety. If real i18n arrives later, {@see for()} can delegate to
 * `__()` without touching call sites.
 *
 * Copy convention (keep consistent across every entry):
 *   • Full sentences, end with a period.
 *   • Curly apostrophe `’` (matches the existing codebase, e.g. "couldn’t").
 *   • Say what happened and what to do next; never blame the user vaguely.
 *   • For money, never leave the user wondering — state the safe fact
 *     ("You weren’t charged") when true.
 */
final class Messages
{
    /**
     * Error-code → default user-facing message. Kept terse and honest; richer,
     * context-bearing copy (amounts, references) is composed at the call site
     * and passed to fail()/notify explicitly.
     */
    private const MAP = [
        // Generic / HTTP
        ErrorCode::VALIDATION_FAILED->value => 'Some details need your attention. Please check the highlighted fields.',
        ErrorCode::UNAUTHENTICATED->value => 'Please sign in to continue.',
        ErrorCode::FORBIDDEN->value => 'You don’t have permission to do that.',
        ErrorCode::NOT_FOUND->value => 'We couldn’t find what you were looking for.',
        ErrorCode::METHOD_NOT_ALLOWED->value => 'That action isn’t available here.',
        ErrorCode::CONFLICT->value => 'This was just updated somewhere else. Refresh and try again.',
        ErrorCode::RATE_LIMITED->value => 'You’re doing that a bit too fast. Please wait a moment and try again.',
        ErrorCode::PAYLOAD_TOO_LARGE->value => 'That upload is too large. Please choose a smaller file.',
        ErrorCode::SERVER_ERROR->value => 'Something went wrong on our end. Please try again in a moment.',

        // Auth / account
        ErrorCode::INVALID_CREDENTIALS->value => 'That email or password doesn’t match our records. Please try again.',
        ErrorCode::ACCOUNT_SUSPENDED->value => 'Your account is suspended. Please contact support for help.',
        ErrorCode::ACCOUNT_INACTIVE->value => 'Your account isn’t active yet. Please contact support if this seems wrong.',
        ErrorCode::OTP_INVALID->value => 'That code isn’t correct. Please check it and try again.',
        ErrorCode::OTP_EXPIRED->value => 'That code has expired. Request a new one to continue.',
        ErrorCode::OTP_MAX_ATTEMPTS->value => 'Too many incorrect attempts. Please request a new code.',
        ErrorCode::OTP_DELIVERY_FAILED->value => 'We couldn’t send your verification code right now. Please try again in a moment.',
        ErrorCode::PASSWORD_RESET_DELIVERY_FAILED->value => 'We couldn’t send your reset email right now. Please try again in a moment.',
        ErrorCode::EMAIL_ALREADY_REGISTERED->value => 'This email is already registered. Try signing in instead.',
        ErrorCode::PHONE_ALREADY_REGISTERED->value => 'This phone number is already registered. Try signing in instead.',

        // Wallet / payments
        ErrorCode::INSUFFICIENT_WALLET_BALANCE->value => 'Your wallet balance is too low for this. Top up or choose another payment method.',
        ErrorCode::PAYMENT_GATEWAY_ERROR->value => 'We couldn’t start your payment right now. You weren’t charged — please try again in a moment.',
        ErrorCode::TOPUP_MIN_AMOUNT->value => 'That amount is below the minimum top-up. Please enter a larger amount.',
        ErrorCode::PAYOUT_MIN_AMOUNT->value => 'That amount is below the minimum payout. Please request a larger amount.',
        ErrorCode::PAYOUT_METHOD_REQUIRED->value => 'Add a bank account or e-wallet before requesting a payout.',
        ErrorCode::PAYOUT_STATE_INVALID->value => 'This payout can’t be changed from its current state.',
        ErrorCode::PAYMENT_METHOD_NOT_FOUND->value => 'That payment method isn’t available on your account.',
        ErrorCode::PAYMENT_ALREADY_SETTLED->value => 'This payment has already been settled.',
        ErrorCode::REFUND_NOT_ALLOWED->value => 'This payment can’t be refunded here.',
        ErrorCode::INVALID_STATUS_TRANSITION->value => 'Something went wrong on our end. Please try again in a moment.',

        // Idempotency
        ErrorCode::IDEMPOTENCY_KEY_REQUIRED->value => 'This request is missing a required safety key. Please update the app and try again.',
        ErrorCode::IDEMPOTENCY_KEY_MISMATCH->value => 'This request doesn’t match its original. Please start over.',
        ErrorCode::IDEMPOTENCY_IN_PROGRESS->value => 'We’re still processing your previous request. Hang tight for a moment.',

        // Bookings
        ErrorCode::BOOKING_NOT_FOUND->value => 'We couldn’t find that booking. It may have been removed.',
        ErrorCode::BOOKING_STATE_INVALID->value => 'This booking has already moved on. Refresh to see its current status.',
        ErrorCode::BOOKING_CONFLICT->value => 'You already have an errand in progress. Finish or cancel it before starting another.',
        ErrorCode::BOOKING_STALE->value => 'This errand was just updated. Pull to refresh and try again.',
        ErrorCode::NO_RUNNER_AVAILABLE->value => 'No runners are available nearby right now. Please try again shortly.',
        ErrorCode::PROMO_INVALID->value => 'That promo code isn’t valid or has expired.',
        ErrorCode::PROMO_NOT_ELIGIBLE->value => 'This order doesn’t qualify for that promo code.',

        // Runner / errand
        ErrorCode::ERRAND_NOT_ASSIGNED->value => 'You’re not assigned to this errand.',
        ErrorCode::INVALID_ERRAND_STATUS->value => 'That step isn’t available for this errand right now.',
        ErrorCode::DOCUMENT_REQUIRED->value => 'A required document is missing. Please upload it to continue.',
        ErrorCode::RUNNER_NOT_APPROVED->value => 'Your account must be approved before you can do that.',

        // Safety / support
        ErrorCode::SOS_ALREADY_ACTIVE->value => 'An emergency alert is already active for this trip.',
        ErrorCode::TRUSTED_CONTACT_LIMIT->value => 'You’ve reached the maximum number of trusted contacts.',
        ErrorCode::TICKET_CLOSED->value => 'This support ticket is closed. Please open a new one if you still need help.',
    ];

    public static function for(ErrorCode $code): string
    {
        return self::MAP[$code->value] ?? 'Something went wrong. Please try again.';
    }
}
