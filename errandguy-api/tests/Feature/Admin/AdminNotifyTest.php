<?php

namespace Tests\Feature\Admin;

use App\Filament\Support\AdminNotify;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AdminNotifyTest extends TestCase
{
    use RefreshDatabase;

    public function test_describe_formats_context_and_drops_empty_values(): void
    {
        $this->assertSame(
            'Booking: EG-1023 · Amount: ₱450.00',
            AdminNotify::describe(['Booking' => 'EG-1023', 'Amount' => '₱450.00']),
        );

        // Null/empty values are dropped so a partial context still reads cleanly.
        $this->assertSame(
            'Booking: EG-1023',
            AdminNotify::describe(['Booking' => 'EG-1023', 'Runner' => null, 'Note' => '']),
        );

        $this->assertSame('', AdminNotify::describe([]));
    }

    public function test_success_with_audit_writes_a_single_activity_row(): void
    {
        $subject = User::factory()->create();

        AdminNotify::success(
            'Booking cancelled',
            $subject,
            context: ['Booking' => 'EG-1023'],
            audit: 'booking.cancelled',
            properties: ['reason' => 'customer no-show'],
        );

        $this->assertDatabaseHas('activity_log', [
            'log_name' => 'admin',
            'event' => 'booking.cancelled',
        ]);
        // Exactly one row — no accidental double-log.
        $this->assertDatabaseCount('activity_log', 1);
    }

    public function test_success_without_audit_does_not_write_an_activity_row(): void
    {
        AdminNotify::success('Profile updated');

        $this->assertDatabaseCount('activity_log', 0);
    }
}
