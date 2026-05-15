<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class LimitRequestSize
{
    /**
     * Reject oversized or malformed request bodies before they reach
     * controllers / form requests.
     *
     * - JSON / form requests are capped at API_MAX_BODY_BYTES
     *   (default 1 MiB). Anything larger is almost certainly an
     *   attack or a misuse of the wrong endpoint — file uploads
     *   go through dedicated multipart routes which use a higher
     *   ceiling (API_MAX_UPLOAD_BYTES, default 12 MiB) enforced
     *   here as well as by per-field `image:max:` rules.
     * - Malformed JSON bodies (non-empty body advertised as JSON
     *   that fails to decode) are rejected with 400 instead of
     *   blowing up inside the framework with a 500.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $jsonCap = (int) env('API_MAX_BODY_BYTES', 1_048_576);      // 1 MiB
        $uploadCap = (int) env('API_MAX_UPLOAD_BYTES', 12_582_912); // 12 MiB

        $isMultipart = str_contains((string) $request->header('Content-Type'), 'multipart/form-data');
        $cap = $isMultipart ? $uploadCap : $jsonCap;

        $declared = (int) $request->header('Content-Length', '0');
        if ($declared > 0 && $declared > $cap) {
            return response()->json([
                'message' => 'Payload too large.',
            ], 413);
        }

        // Fallback for chunked uploads where Content-Length is absent:
        // measure the actual body once read.
        $bodySize = strlen((string) $request->getContent());
        if ($bodySize > $cap) {
            return response()->json([
                'message' => 'Payload too large.',
            ], 413);
        }

        if ($request->isJson() && $bodySize > 0) {
            $decoded = json_decode($request->getContent(), true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                return response()->json([
                    'message' => 'Malformed JSON payload.',
                ], 400);
            }
            // Block deeply nested / pathologically wide objects that
            // can DoS validation. 64 keys at root, 8 nesting levels
            // is far beyond anything the API legitimately accepts.
            if (is_array($decoded) && $this->exceedsShape($decoded, 0)) {
                return response()->json([
                    'message' => 'Malformed JSON payload.',
                ], 400);
            }
        }

        return $next($request);
    }

    private function exceedsShape(array $data, int $depth): bool
    {
        if ($depth > 8) {
            return true;
        }
        if (count($data) > 256) {
            return true;
        }
        foreach ($data as $value) {
            if (is_array($value) && $this->exceedsShape($value, $depth + 1)) {
                return true;
            }
        }
        return false;
    }
}
