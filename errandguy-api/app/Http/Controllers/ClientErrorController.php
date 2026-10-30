<?php

namespace App\Http\Controllers;

use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Ingest client (mobile) crash reports so a production crash on a RELEASE build
 * — where console.* goes nowhere — becomes a visible, alertable server-side
 * signal instead of vanishing. Closes the "mobile crash SDK" observability gap
 * without a native rebuild.
 *
 * Signed in or not: a crash on the sign-in or sign-up screen matters as much
 * as one after. A bearer token, when sent, only adds the user id for
 * correlation. Throttled per account / per IP ('client-errors') and capped at
 * MAX_BODY_BYTES.
 *
 * Log-only by design: no DB write (avoids a spammable table), PII-careful (only
 * the error text/stack the client already held, the app version and platform,
 * plus the user id when signed in — no request bodies, tokens or contacts).
 * The structured Log line flows into the same stream ops already watch and,
 * once the Sentry log integration / a log alert is wired, into alerting.
 */
class ClientErrorController extends Controller
{
    /** Comfortably above the largest valid report (the field caps add up to ~17 KB). */
    private const MAX_BODY_BYTES = 24576;

    public function store(Request $request): JsonResponse
    {
        if (strlen((string) $request->getContent()) > self::MAX_BODY_BYTES) {
            return $this->fail(ErrorCode::PAYLOAD_TOO_LARGE, 'That crash report is too large.');
        }

        $data = $request->validate([
            'message' => ['required', 'string', 'max:1000'],
            'name' => ['nullable', 'string', 'max:200'],
            'stack' => ['nullable', 'string', 'max:8000'],
            'component_stack' => ['nullable', 'string', 'max:8000'],
            'fatal' => ['nullable', 'boolean'],
            'platform' => ['nullable', 'string', 'max:20'],
            'app_version' => ['nullable', 'string', 'max:30'],
            'screen' => ['nullable', 'string', 'max:120'],
        ]);

        $fatal = (bool) ($data['fatal'] ?? false);
        // The body is what the app sends; the headers are a fallback for a
        // build that only stamps them on every request.
        $platform = $data['platform'] ?? (Str::limit((string) $request->header('X-Platform'), 20, '') ?: null);
        $appVersion = $data['app_version'] ?? (Str::limit((string) $request->header('X-App-Version'), 30, '') ?: null);

        Log::log($fatal ? 'error' : 'warning', '[client-crash] '.Str::limit($data['message'], 300), [
            'user_id' => auth('sanctum')->user()?->getAuthIdentifier(),
            'signed_in' => auth('sanctum')->check(),
            'fatal' => $fatal,
            'name' => $data['name'] ?? null,
            'platform' => $platform,
            'app_version' => $appVersion,
            'screen' => $data['screen'] ?? null,
            'stack' => $data['stack'] ?? null,
            'component_stack' => $data['component_stack'] ?? null,
            'ip' => $request->ip(),
        ]);

        return response()->json(['status' => 'ok']);
    }
}
