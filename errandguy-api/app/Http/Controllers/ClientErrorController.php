<?php

namespace App\Http\Controllers;

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
 * Log-only by design: no DB write (avoids a spammable table), PII-careful (only
 * the error text/stack the client already held, plus the authenticated user id
 * for correlation — no request bodies, tokens or contacts), and tightly bounded
 * in field size + request rate. The structured Log line flows into the same
 * stream ops already watch and, once the Sentry log integration / a log alert is
 * wired, into alerting.
 */
class ClientErrorController extends Controller
{
    public function store(Request $request): JsonResponse
    {
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

        Log::log($fatal ? 'error' : 'warning', '[client-crash] '.Str::limit($data['message'], 300), [
            'user_id' => $request->user()?->id,
            'fatal' => $fatal,
            'name' => $data['name'] ?? null,
            'platform' => $data['platform'] ?? null,
            'app_version' => $data['app_version'] ?? null,
            'screen' => $data['screen'] ?? null,
            'stack' => $data['stack'] ?? null,
            'component_stack' => $data['component_stack'] ?? null,
        ]);

        return response()->json(['status' => 'ok']);
    }
}
