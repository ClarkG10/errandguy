<?php

namespace Tests\Feature\Observability;

use App\Jobs\WorkerHeartbeatJob;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * GET /health is what an outside uptime monitor watches: database, cache,
 * scheduler, queue worker and the Reverb (live updates) server. Any failure
 * answers 503 so the monitor alerts.
 */
class HealthCheckTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::put('scheduler:heartbeat', now()->timestamp, 900);
        Cache::put(WorkerHeartbeatJob::CACHE_KEY, now()->timestamp, 900);
    }

    private function useReverb(): void
    {
        config([
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.options' => ['host' => '127.0.0.1', 'port' => 8080, 'scheme' => 'http'],
        ]);
    }

    public function test_everything_up_is_a_200(): void
    {
        $this->useReverb();
        Http::fake(['http://127.0.0.1:8080/up' => Http::response('', 200)]);

        $this->getJson('/health')
            ->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('checks.database', 'up')
            ->assertJsonPath('checks.cache', 'up')
            ->assertJsonPath('checks.scheduler', 'ok')
            ->assertJsonPath('checks.worker', 'ok')
            ->assertJsonPath('checks.realtime', 'up');
    }

    public function test_a_stale_worker_heartbeat_fails_the_probe(): void
    {
        Cache::put(WorkerHeartbeatJob::CACHE_KEY, now()->timestamp - 240, 900);

        $this->getJson('/health')
            ->assertStatus(503)
            ->assertJsonPath('status', 'degraded')
            ->assertJsonPath('checks.worker', 'stale');
    }

    public function test_a_worker_that_never_ran_the_heartbeat_fails_the_probe(): void
    {
        Cache::forget(WorkerHeartbeatJob::CACHE_KEY);

        $this->getJson('/health')->assertStatus(503)->assertJsonPath('checks.worker', 'unknown');
    }

    public function test_the_heartbeat_job_stamps_the_worker_as_alive(): void
    {
        Cache::forget(WorkerHeartbeatJob::CACHE_KEY);

        (new WorkerHeartbeatJob())->handle();

        $this->getJson('/health')->assertOk()->assertJsonPath('checks.worker', 'ok');
    }

    public function test_the_scheduler_queues_the_worker_heartbeat_every_minute(): void
    {
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($event) => $event->description === 'worker-heartbeat');

        $this->assertNotNull($event, 'worker-heartbeat is not scheduled');
        $this->assertSame('* * * * *', $event->expression);
    }

    public function test_an_unreachable_reverb_server_fails_the_probe(): void
    {
        $this->useReverb();
        Http::fake(['http://127.0.0.1:8080/up' => fn () => throw new \Illuminate\Http\Client\ConnectionException('refused')]);

        $this->getJson('/health')
            ->assertStatus(503)
            ->assertJsonPath('checks.realtime', 'down');
    }

    public function test_a_reverb_error_status_fails_the_probe(): void
    {
        $this->useReverb();
        Http::fake(['http://127.0.0.1:8080/up' => Http::response('', 500)]);

        $this->getJson('/health')->assertStatus(503)->assertJsonPath('checks.realtime', 'down');
    }

    public function test_realtime_is_not_probed_when_broadcasting_is_off(): void
    {
        config(['broadcasting.default' => 'null']);
        Http::fake();

        $this->getJson('/health')->assertOk()->assertJsonPath('checks.realtime', 'disabled');
        Http::assertNothingSent();
    }
}
