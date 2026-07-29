<?php

namespace App\Http\Middleware;

use App\Support\RequestMetrics;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class LogApiRequests
{
    /** Skip logging for high-frequency endpoints that swamp the log channel. */
    private const SKIP_PATTERNS = [
        'runner/location',
        'chat/unread-count',
    ];

    /** Endpoints over this threshold are always logged so we can spot slow ones. */
    private const SLOW_THRESHOLD_MS = 500;

    /** Query count above which a request is logged even if fast — a strong
     *  N+1 / unbounded-fetch signal, which is what caps throughput at scale. */
    private const HIGH_QUERY_THRESHOLD = 40;

    public function handle(Request $request, Closure $next): Response
    {
        $start = microtime(true);

        // Reset the per-request query counter (AppServiceProvider's DB::listen
        // increments it) so the count below reflects only this request.
        app(RequestMetrics::class)->queries = 0;

        $response = $next($request);

        $duration = round((microtime(true) - $start) * 1000, 2);
        $status = $response->getStatusCode();
        $path = $request->path();

        // Hot-path noise filter: skip the GPS push and unread-count
        // poller (each fires every few seconds per online user). We
        // were spending 2 file-locking writes per request on log lines
        // nobody reads.
        $isHotPath = false;
        foreach (self::SKIP_PATTERNS as $needle) {
            if (str_contains($path, $needle)) {
                $isHotPath = true;
                break;
            }
        }

        $queries = app(RequestMetrics::class)->queries;
        $isError = $status >= 400;
        $isSlow = $duration > self::SLOW_THRESHOLD_MS;
        // A fast 2xx that ran a lot of queries is almost always an N+1 or an
        // unbounded fetch — the thing that quietly caps throughput. Surface it.
        $isHeavy = $queries > self::HIGH_QUERY_THRESHOLD;

        // The per-request `API Response` info line fired a file-lock append
        // on ~every request — at scale that write is itself a bottleneck,
        // and in prod the file channel is not where anyone reads success
        // traffic. Drop the fast-success line on hot paths always, and in
        // production everywhere; keep it for local/staging debugging. Errors,
        // slow requests, and query-heavy requests below still log in every
        // environment (the only latency/query-load signal until APM lands).
        if (! $isError && ! $isSlow && ! $isHeavy && ($isHotPath || app()->isProduction())) {
            return $response;
        }

        $logData = [
            'method' => $request->method(),
            'url' => $request->fullUrl(),
            'status' => $status,
            'duration_ms' => $duration,
            'queries' => $queries,
            'user_id' => $request->user()?->id,
            // Correlation id assigned by AssignRequestId (runs before this
            // middleware). Also present via Log::withContext, but made explicit
            // here so it survives context stripping and stays greppable.
            'request_id' => $request->attributes->get('request_id'),
        ];

        if ($isError) {
            $content = $response->getContent();
            $decoded = json_decode($content, true);
            $logData['response_body'] = $decoded ?? mb_substr($content, 0, 500);

            Log::warning('API Error Response', $logData);
        } elseif ($isSlow || $isHeavy) {
            // Slow and/or query-heavy but successful — kept in every environment
            // (prod included) at `notice` so it survives the info suppression
            // above and stays findable as our pre-APM latency/query signal.
            Log::notice('API Slow Response', $logData);
        } else {
            Log::info('API Response', $logData);
        }

        return $response;
    }
}
