<?php

namespace App\Http\Middleware;

use App\Models\IdempotencyKey;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Durable idempotency guard for money-mutation endpoints (booking create,
 * wallet top-up, payout request). The client sends a stable `Idempotency-Key`
 * per payment attempt and reuses it on retry; this middleware guarantees that
 * a replay of the SAME attempt returns the SAME outcome instead of charging /
 * booking twice.
 *
 *   • no key             → soft pass-through + warning (Phase 1: clients are
 *                          rolling out the header; flip to a hard 428 once the
 *                          app ships have propagated).
 *   • new key            → run once, store the JSON outcome for replay.
 *   • replay, completed  → return the stored response verbatim.
 *   • replay, in-flight  → 409 (the first request is still running).
 *   • same key, diff body → 422 (the key is being misused).
 *
 * The 60s WalletController fast-path dedupe still stands in front of this as a
 * cheap first line; this is the durable backstop. It is not the ONLY safety
 * net either — the gateway also receives a deterministic Idempotency-key, and
 * webhook settlement is guarded by row locks + terminal-state checks.
 */
class EnsureIdempotency
{
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');

        if (blank($key)) {
            Log::warning('Idempotency-Key header missing on money-mutation route', [
                'path' => $request->path(),
                'user_id' => $request->user()?->id,
            ]);
            return $next($request);
        }

        $userId = $request->user()?->id;
        $hash = hash('sha256', $request->method() . '|' . $request->path() . '|' . json_encode($request->all()));

        $existing = IdempotencyKey::where('user_id', $userId)
            ->where('idem_key', $key)
            ->first();

        if ($existing) {
            if ($existing->status === 'completed') {
                if ($existing->request_hash !== $hash) {
                    return response()->json([
                        'message' => 'This Idempotency-Key was already used with a different request.',
                    ], 422);
                }
                return response()->json($existing->response_body ?? [], $existing->response_code ?? 200);
            }

            // Still in flight — the original request hasn't finished.
            return response()->json([
                'message' => 'A payment with this reference is still being processed. Please wait a moment.',
            ], 409);
        }

        // First time we've seen this key. Claim it; a concurrent duplicate that
        // races us loses on the unique constraint and is told to wait.
        try {
            $record = IdempotencyKey::create([
                'user_id' => $userId,
                'idem_key' => $key,
                'method' => $request->method(),
                'path' => $request->path(),
                'request_hash' => $hash,
                'status' => 'in_progress',
                'locked_at' => now(),
                'expires_at' => now()->addDay(),
            ]);
        } catch (QueryException $e) {
            return response()->json([
                'message' => 'A payment with this reference is still being processed. Please wait a moment.',
            ], 409);
        }

        try {
            $response = $next($request);
        } catch (\Throwable $e) {
            // The handler blew up — drop the claim so a genuine retry isn't
            // permanently 409'd, and let the exception surface as normal.
            $this->release($record);
            throw $e;
        }

        $status = $response->getStatusCode();

        // Only a definitive JSON outcome (2xx or 4xx) is safe to replay. A 5xx
        // is transient — release the claim so the client can retry cleanly.
        if ($status >= 500 || ! $response instanceof JsonResponse) {
            $this->release($record);
            return $response;
        }

        try {
            $record->update([
                'status' => 'completed',
                'response_code' => $status,
                'response_body' => $response->getData(true),
            ]);
        } catch (\Throwable $e) {
            Log::warning('Failed to persist idempotent response', [
                'idem_key' => $key,
                'error' => $e->getMessage(),
            ]);
        }

        return $response;
    }

    private function release(IdempotencyKey $record): void
    {
        try {
            $record->delete();
        } catch (\Throwable $e) {
            // Best-effort; the row will expire regardless.
        }
    }
}
