<?php

namespace App\Exceptions;

use App\Support\ApiPayload;
use App\Support\ErrorCode;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Registers the API exception → standardized-envelope render map, called once
 * from `bootstrap/app.php` withExceptions(). Every branch emits the same
 * {@see ApiPayload} envelope controllers use, so a thrown exception is
 * indistinguishable in shape from a `return $this->fail(...)`.
 *
 * All closures are guarded to API/JSON requests ({@see wantsJson()}) so
 * Filament's web error pages and redirects are left entirely alone.
 *
 * Ordering matters: Laravel returns the FIRST render callback that yields a
 * non-null response, evaluated in registration order. The specific closures are
 * registered first; the `\Throwable` catch-all is registered LAST so it only
 * handles what nothing else claimed.
 */
final class ApiExceptionRenderer
{
    public static function register(Exceptions $exceptions): void
    {
        // Inline $request->validate() failures. (ApiFormRequest renders its own,
        // identically.) Lead with the first field error; detail stays in `errors`.
        $exceptions->render(fn (ValidationException $e, Request $r) => self::wantsJson($r)
            ? self::json(ErrorCode::VALIDATION_FAILED, $e->validator->errors()->first() ?: null, $e->errors())
            : null);

        $exceptions->render(fn (AuthenticationException $e, Request $r) => self::wantsJson($r)
            ? self::json(ErrorCode::UNAUTHENTICATED)
            : null);

        // Framework authorization (Gate/policy) failures.
        $exceptions->render(fn (AuthorizationException $e, Request $r) => self::wantsJson($r)
            ? self::json(ErrorCode::FORBIDDEN, self::cleanMessage($e->getMessage()))
            : null);

        // Raw model lookups — NEVER leak the model class name in the message.
        $exceptions->render(fn (ModelNotFoundException $e, Request $r) => self::wantsJson($r)
            ? self::json(ErrorCode::NOT_FOUND)
            : null);

        // Domain state rejections → 422 with a specific code; keep their own copy.
        $exceptions->render(fn (BookingStateException $e, Request $r) => self::wantsJson($r)
            ? self::json(ErrorCode::BOOKING_STATE_INVALID, self::cleanMessage($e->getMessage()))
            : null);

        $exceptions->render(fn (PayoutStateException $e, Request $r) => self::wantsJson($r)
            ? self::json(ErrorCode::PAYOUT_STATE_INVALID, self::cleanMessage($e->getMessage()))
            : null);

        // Gateway rejection → 422, NEVER an app-level 5xx: Cloudflare masks 502s
        // and the mobile interceptor discards >=500 messages. The real reason is
        // logged (by the service) and surfaced only in debug meta, never to users.
        $exceptions->render(function (PaymentGatewayException $e, Request $r) {
            if (! self::wantsJson($r)) {
                return null;
            }
            $meta = config('app.debug') ? ['debug' => $e->reason()] : [];

            return self::json(ErrorCode::PAYMENT_GATEWAY_ERROR, null, [], $meta);
        });

        // Illegal status transition = a logic error, not a control-flow path →
        // 500, generic copy, logged. Internals only in debug meta.
        $exceptions->render(fn (InvalidStatusTransitionException $e, Request $r) => self::wantsJson($r)
            ? self::json(ErrorCode::INVALID_STATUS_TRANSITION, null, [], self::debugMeta($e), 500)
            : null);

        // Catch-all LAST: prepared HTTP exceptions mapped by status; everything
        // else gets an honest 500 with no leaked internals.
        $exceptions->render(function (\Throwable $e, Request $r) {
            if (! self::wantsJson($r)) {
                return null;
            }

            return self::fallback($e);
        });
    }

    private static function wantsJson(Request $request): bool
    {
        // Match ONLY the mobile API surface (everything lives under /api/*).
        // Do NOT also key off $request->expectsJson(): Filament runs on Livewire,
        // whose update requests satisfy expectsJson(), so including it made this
        // renderer hijack Filament exceptions into a JSON envelope Livewire can't
        // parse — surfacing as "Error while loading page" on every admin
        // tab/filter/poll. Restricting to the path leaves web/admin/Livewire to
        // Filament's own error handling.
        return $request->is('api/*');
    }

    private static function fallback(\Throwable $e): JsonResponse
    {
        if ($e instanceof HttpExceptionInterface) {
            $status = $e->getStatusCode();

            if ($status < 500) {
                // [ErrorCode, prefer-exception-message?]
                [$code, $useOwnMessage] = match ($status) {
                    401 => [ErrorCode::UNAUTHENTICATED, false],
                    403 => [ErrorCode::FORBIDDEN, true],   // intentional abort(403, '…')
                    404 => [ErrorCode::NOT_FOUND, false],
                    405 => [ErrorCode::METHOD_NOT_ALLOWED, false],
                    409 => [ErrorCode::CONFLICT, true],
                    413 => [ErrorCode::PAYLOAD_TOO_LARGE, false],
                    429 => [ErrorCode::RATE_LIMITED, false],
                    default => [null, false],
                };

                if ($code === null) {
                    // Unmapped 4xx — keep the status, generic-ish message.
                    return response()->json(
                        ApiPayload::error('HTTP_'.$status, self::cleanMessage($e->getMessage()) ?? 'Request could not be completed.'),
                        $status,
                    );
                }

                $meta = [];
                if ($code === ErrorCode::RATE_LIMITED) {
                    $retry = $e->getHeaders()['Retry-After'] ?? null;
                    if ($retry !== null) {
                        $meta['retry_after'] = (int) $retry;
                    }
                }

                $message = ($useOwnMessage ? self::cleanMessage($e->getMessage()) : null);

                return self::json($code, $message, [], $meta, $status);
            }
        }

        // Unhandled or >=500: honest generic 500, no internals in the user message.
        return self::json(ErrorCode::SERVER_ERROR, null, [], self::debugMeta($e), 500);
    }

    /**
     * Enrich `meta.debug` ONLY when APP_DEBUG is on. Never touches the
     * user-facing `message`, so nothing leaks in production, and even with debug
     * on the mobile client still shows its own generic >=500 copy.
     *
     * @return array<string,mixed>
     */
    private static function debugMeta(\Throwable $e): array
    {
        if (! config('app.debug')) {
            return [];
        }

        return ['debug' => [
            'exception' => get_class($e),
            'message' => $e->getMessage(),
            'at' => $e->getFile().':'.$e->getLine(),
        ]];
    }

    /** Empty strings become null so ApiPayload falls back to the code's default copy. */
    private static function cleanMessage(?string $message): ?string
    {
        $message = trim((string) $message);

        return $message === '' ? null : $message;
    }

    /**
     * @param  array<string,array<int,string>|string>  $errors
     * @param  array<string,mixed>  $meta
     */
    private static function json(ErrorCode $code, ?string $message = null, array $errors = [], array $meta = [], ?int $status = null): JsonResponse
    {
        return response()->json(
            ApiPayload::error($code->value, $message ?? $code->defaultMessage(), $errors, $meta),
            $status ?? $code->httpStatus(),
        );
    }
}
