<?php

namespace Tests\Feature\Maintenance;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The SOS / support / acceptance-rate schema migrations are guarded: a re-run
 * after a partial failure is a no-op, and down() then up() round-trips.
 */
class SafetySupportMigrationsTest extends TestCase
{
    use RefreshDatabase;

    private function migration(string $file): object
    {
        return require database_path("migrations/{$file}");
    }

    public function test_the_sos_location_and_resolver_columns_round_trip(): void
    {
        $m = $this->migration('2026_10_31_000008_add_location_and_resolver_to_sos_alerts.php');
        $columns = ['trigger_lat', 'trigger_lng', 'trigger_accuracy_m', 'trigger_location_source', 'resolved_by', 'resolved_by_type'];

        $this->assertTrue(Schema::hasColumns('sos_alerts', $columns));
        $m->up();
        $m->down();
        foreach ($columns as $column) {
            $this->assertFalse(Schema::hasColumn('sos_alerts', $column));
        }
        $m->down();
        $m->up();
        $this->assertTrue(Schema::hasColumns('sos_alerts', $columns));
    }

    public function test_the_reported_user_column_round_trips(): void
    {
        $m = $this->migration('2026_10_31_000009_add_reported_user_to_support_tickets.php');

        $this->assertTrue(Schema::hasColumn('support_tickets', 'reported_user_id'));
        $m->up();
        $m->down();
        $this->assertFalse(Schema::hasColumn('support_tickets', 'reported_user_id'));
        $m->down();
        $m->up();
        $this->assertTrue(Schema::hasColumn('support_tickets', 'reported_user_id'));
    }

    public function test_the_acceptance_rate_drop_round_trips(): void
    {
        $m = $this->migration('2026_10_31_000012_drop_runner_acceptance_rate.php');

        $this->assertFalse(Schema::hasColumn('runner_profiles', 'acceptance_rate'));
        $m->up();
        $m->down();
        $this->assertTrue(Schema::hasColumn('runner_profiles', 'acceptance_rate'));
        $m->down();
        $m->up();
        $this->assertFalse(Schema::hasColumn('runner_profiles', 'acceptance_rate'));
    }
}
