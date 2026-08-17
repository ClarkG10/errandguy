<?php

namespace Tests\Feature\Support;

use Illuminate\Routing\Route;
use Tests\TestCase;

/**
 * The legacy POST /support/report writes a DisputeTicket into the ops moderation
 * queue just like its modern sibling POST /support/tickets, so it must carry the
 * same per-route throttle rather than sitting on the looser 240/min global limiter.
 */
class SupportReportThrottleTest extends TestCase
{
    public function test_support_report_carries_the_same_throttle_as_tickets(): void
    {
        $route = collect(app('router')->getRoutes()->getRoutes())
            ->first(fn (Route $r) => $r->uri() === 'api/v1/support/report' && in_array('POST', $r->methods(), true));

        $this->assertNotNull($route, 'POST api/v1/support/report must exist');
        $this->assertContains('throttle:15,1', $route->gatherMiddleware());
    }
}
