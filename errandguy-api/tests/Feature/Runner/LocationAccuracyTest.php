<?php

namespace Tests\Feature\Runner;

use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * runner_locations.accuracy is decimal(5,2) (ceiling 999.99). GPS on a weak fix
 * reports 1000-5000 m, which would 500 the location ping under strict-mode MySQL
 * and drop the runner off the live map. The request now nulls an out-of-range
 * accuracy so the ping still lands. (schema sweep)
 */
class LocationAccuracyTest extends TestCase
{
    use RefreshDatabase;

    private function runner(): User
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved',
            'is_online' => true, 'preferred_types' => [],
        ]);
        Sanctum::actingAs($runner);

        return $runner;
    }

    public function test_out_of_range_accuracy_is_nulled_and_the_ping_succeeds(): void
    {
        $runner = $this->runner();

        $this->postJson('/api/v1/runner/location', [
            'lat' => 14.60, 'lng' => 120.98, 'accuracy' => 1500, // > 999.99 column ceiling
        ])->assertSuccessful();

        $this->assertDatabaseHas('runner_locations', [
            'runner_id' => $runner->id,
            'accuracy' => null, // nulled, not overflowed
        ]);
    }

    public function test_normal_accuracy_is_preserved(): void
    {
        $runner = $this->runner();

        $this->postJson('/api/v1/runner/location', [
            'lat' => 14.60, 'lng' => 120.98, 'accuracy' => 12.5,
        ])->assertSuccessful();

        $row = \App\Models\RunnerLocation::where('runner_id', $runner->id)->first();
        $this->assertNotNull($row);
        $this->assertEqualsWithDelta(12.5, (float) $row->accuracy, 0.001);
    }
}
