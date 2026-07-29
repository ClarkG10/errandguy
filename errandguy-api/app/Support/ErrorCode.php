<?php

namespace App\Support;

/**
 * Machine-readable error codes for the standardized API envelope.
 *
 * The `code` travels alongside the human `message` on every error response, so
 * the mobile client can map a stable identifier to its own honest, localizable
 * copy (see errandguy-mobile `src/utils/errorCatalog.ts`) instead of parsing
 * free-text. Server-side, {@see \App\Support\ApiResponse::fail()} and the
 * exception render map in `bootstrap/app.php` both emit these.
 *
 * Each case owns its default HTTP status ({@see httpStatus()}) and default
 * user-facing copy ({@see defaultMessage()}, sourced from {@see Messages}), so a
 * controller can `return $this->fail(ErrorCode::INSUFFICIENT_WALLET_BALANCE)`
 * and get the right status + copy with no repetition.
 */
enum ErrorCode: string
{
    // ── Generic / HTTP ────────────────────────────────────────────────
    case VALIDATION_FAILED = 'VALIDATION_FAILED';
    case UNAUTHENTICATED = 'UNAUTHENTICATED';
    case FORBIDDEN = 'FORBIDDEN';
    case NOT_FOUND = 'NOT_FOUND';
    case METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED';
    case CONFLICT = 'CONFLICT';
    case RATE_LIMITED = 'RATE_LIMITED';
    case PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE';
    case SERVER_ERROR = 'SERVER_ERROR';

    // ── Auth / account ────────────────────────────────────────────────
    case INVALID_CREDENTIALS = 'INVALID_CREDENTIALS';
    case ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED';
    case ACCOUNT_INACTIVE = 'ACCOUNT_INACTIVE';
    case OTP_INVALID = 'OTP_INVALID';
    case OTP_EXPIRED = 'OTP_EXPIRED';
    case OTP_MAX_ATTEMPTS = 'OTP_MAX_ATTEMPTS';
    case OTP_DELIVERY_FAILED = 'OTP_DELIVERY_FAILED';
    case PASSWORD_RESET_DELIVERY_FAILED = 'PASSWORD_RESET_DELIVERY_FAILED';
    case EMAIL_ALREADY_REGISTERED = 'EMAIL_ALREADY_REGISTERED';
    case PHONE_ALREADY_REGISTERED = 'PHONE_ALREADY_REGISTERED';

    // ── Wallet / payments (financial) ─────────────────────────────────
    case INSUFFICIENT_WALLET_BALANCE = 'INSUFFICIENT_WALLET_BALANCE';
    case PAYMENT_GATEWAY_ERROR = 'PAYMENT_GATEWAY_ERROR';
    case TOPUP_MIN_AMOUNT = 'TOPUP_MIN_AMOUNT';
    case PAYOUT_MIN_AMOUNT = 'PAYOUT_MIN_AMOUNT';
    case PAYOUT_METHOD_REQUIRED = 'PAYOUT_METHOD_REQUIRED';
    case PAYOUT_STATE_INVALID = 'PAYOUT_STATE_INVALID';
    case PAYMENT_METHOD_NOT_FOUND = 'PAYMENT_METHOD_NOT_FOUND';
    case PAYMENT_ALREADY_SETTLED = 'PAYMENT_ALREADY_SETTLED';
    case REFUND_NOT_ALLOWED = 'REFUND_NOT_ALLOWED';
    case INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION';

    // ── Idempotency ───────────────────────────────────────────────────
    case IDEMPOTENCY_KEY_REQUIRED = 'IDEMPOTENCY_KEY_REQUIRED';
    case IDEMPOTENCY_KEY_MISMATCH = 'IDEMPOTENCY_KEY_MISMATCH';
    case IDEMPOTENCY_IN_PROGRESS = 'IDEMPOTENCY_IN_PROGRESS';

    // ── Bookings ──────────────────────────────────────────────────────
    case BOOKING_NOT_FOUND = 'BOOKING_NOT_FOUND';
    case BOOKING_STATE_INVALID = 'BOOKING_STATE_INVALID';
    case BOOKING_CONFLICT = 'BOOKING_CONFLICT';
    case BOOKING_STALE = 'BOOKING_STALE';
    case NO_RUNNER_AVAILABLE = 'NO_RUNNER_AVAILABLE';
    case PROMO_INVALID = 'PROMO_INVALID';
    case PROMO_NOT_ELIGIBLE = 'PROMO_NOT_ELIGIBLE';

    // ── Runner / errand ───────────────────────────────────────────────
    case ERRAND_NOT_ASSIGNED = 'ERRAND_NOT_ASSIGNED';
    case INVALID_ERRAND_STATUS = 'INVALID_ERRAND_STATUS';
    case DOCUMENT_REQUIRED = 'DOCUMENT_REQUIRED';
    case RUNNER_NOT_APPROVED = 'RUNNER_NOT_APPROVED';

    // ── Safety / support ──────────────────────────────────────────────
    case SOS_ALREADY_ACTIVE = 'SOS_ALREADY_ACTIVE';
    case TRUSTED_CONTACT_LIMIT = 'TRUSTED_CONTACT_LIMIT';
    case TICKET_CLOSED = 'TICKET_CLOSED';

    /** Default HTTP status for this code. Callers may override per endpoint. */
    public function httpStatus(): int
    {
        return match ($this) {
            self::UNAUTHENTICATED, self::INVALID_CREDENTIALS => 401,
            self::FORBIDDEN, self::ACCOUNT_SUSPENDED, self::ACCOUNT_INACTIVE,
            self::RUNNER_NOT_APPROVED => 403,
            self::NOT_FOUND, self::BOOKING_NOT_FOUND, self::PAYMENT_METHOD_NOT_FOUND => 404,
            self::METHOD_NOT_ALLOWED => 405,
            self::CONFLICT, self::BOOKING_CONFLICT, self::BOOKING_STALE,
            self::IDEMPOTENCY_IN_PROGRESS, self::SOS_ALREADY_ACTIVE => 409,
            self::PAYLOAD_TOO_LARGE => 413,
            self::IDEMPOTENCY_KEY_REQUIRED => 428,
            self::RATE_LIMITED => 429,
            // Logic errors surface as 500 (logged, not user-controlled flow).
            self::SERVER_ERROR, self::INVALID_STATUS_TRANSITION => 500,
            // Everything else is a handled 4xx business-rule rejection.
            // 422 keeps gateway failures off the app-level 5xx path that
            // Cloudflare masks (see plan guardrails).
            default => 422,
        };
    }

    /** Default user-facing copy for this code (single source of truth). */
    public function defaultMessage(): string
    {
        return Messages::for($this);
    }
}
