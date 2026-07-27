<?php

namespace Tests\Feature\Performance;

use App\Models\User;
use App\Support\RequestMetrics;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The per-request DB-query counter (AppServiceProvider's DB::listen +
 * RequestMetrics, reset by LogApiRequests) is the pre-APM "measure" signal:
 * it lets the slow/error log surface query counts and flag likely N+1s.
 */
class RequestMetricsTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_counts_db_queries_run_during_a_request(): void
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->actingAs($user)->getJson('/api/v1/notifications')->assertOk();

        // The listener increments per query and the middleware reset it at the
        // start of the request, so the count reflects just that request's DB work.
        $this->assertGreaterThan(0, app(RequestMetrics::class)->queries);
    }
}
