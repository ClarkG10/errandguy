<?php

namespace App\Support;

/**
 * Per-request counters for lightweight, self-hosted observability — the "measure
 * and validate" baseline until a full APM (Sentry) is wired (that needs an
 * external DSN; see docs/scaling-tier0-rollout.md).
 *
 * Bound as a singleton, so in the standard (non-Octane) request lifecycle a
 * fresh instance exists per request. AppServiceProvider wires a `DB::listen`
 * that increments {@see $queries}; LogApiRequests resets it at the start of each
 * request and reads it at the end to surface the query count on slow/error
 * responses and to flag likely N+1s (a high count on a fast 2xx) — the query
 * pressure that actually caps throughput at scale.
 */
class RequestMetrics
{
    /** DB queries executed on the default connection during this request. */
    public int $queries = 0;
}
