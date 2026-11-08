<?php

namespace Tests\Feature\Support;

use App\Filament\Resources\SupportTickets\Pages\ListSupportTickets;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Support tickets are the one complaint channel:
 *   - "Report a problem" from an errand: booking_id + category on the ticket;
 *   - "Report this person": category 'report_user', the booking, and the
 *     other person on it as reported_user_id — filterable by staff.
 */
class ErrandReportsTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;
    private User $runner;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'full_name' => 'Maria Santos']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'full_name' => 'Jun Cruz']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12, 'per_km_motorcycle' => 10,
            'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        $this->booking = $this->booking($type, $this->customer, $this->runner, 'EG-REPORT-1');
    }

    private function booking(ErrandType $type, User $customer, ?User $runner, string $number): Booking
    {
        return Booking::create([
            'booking_number' => $number, 'customer_id' => $customer->id, 'runner_id' => $runner?->id,
            'errand_type_id' => $type->id, 'status' => 'completed', 'pickup_address' => 'A', 'pickup_lat' => 14.6,
            'pickup_lng' => 120.98, 'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle', 'distance_km' => 5,
            'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0, 'total_amount' => 115,
            'runner_payout' => 85, 'is_transportation' => false,
        ]);
    }

    private function report(User $as, array $body)
    {
        return $this->actingAs($as)->postJson('/api/v1/support/tickets', array_merge([
            'subject' => 'Something went wrong', 'message' => 'Details here.',
        ], $body));
    }

    public function test_a_problem_report_is_linked_to_the_errand_and_category(): void
    {
        $this->report($this->customer, ['booking_id' => $this->booking->id, 'category' => 'item_damaged'])
            ->assertCreated()
            ->assertJsonPath('data.booking_id', $this->booking->id)
            ->assertJsonPath('data.category', 'item_damaged')
            ->assertJsonPath('data.reported_user_id', null);
    }

    public function test_a_double_tap_opens_one_ticket_not_two(): void
    {
        $first = $this->report($this->customer, ['booking_id' => $this->booking->id, 'category' => 'item_damaged'])->assertCreated();
        $second = $this->report($this->customer, ['booking_id' => $this->booking->id, 'category' => 'item_damaged'])->assertCreated();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame(1, \App\Models\SupportTicket::where('user_id', $this->customer->id)->count());

        // A different problem is a different ticket.
        $this->report($this->customer, ['booking_id' => $this->booking->id, 'category' => 'item_damaged', 'subject' => 'Runner was rude'])->assertCreated();
        $this->assertSame(2, \App\Models\SupportTicket::where('user_id', $this->customer->id)->count());
    }

    public function test_a_report_cannot_point_at_someone_elses_errand(): void
    {
        $stranger = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->report($stranger, ['booking_id' => $this->booking->id, 'category' => 'other'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['booking_id']);
    }

    public function test_a_customer_can_report_the_runner_and_a_runner_the_customer(): void
    {
        $this->report($this->customer, [
            'category' => 'report_user', 'booking_id' => $this->booking->id, 'reported_user_id' => $this->runner->id,
        ])->assertCreated()
            ->assertJsonPath('data.category', 'report_user')
            ->assertJsonPath('data.reported_user_id', $this->runner->id);

        $this->report($this->runner, [
            'category' => 'report_user', 'booking_id' => $this->booking->id, 'reported_user_id' => $this->customer->id,
        ])->assertCreated();

        $this->assertDatabaseHas('support_tickets', [
            'user_id' => $this->customer->id, 'category' => 'report_user',
            'booking_id' => $this->booking->id, 'reported_user_id' => $this->runner->id,
        ]);
    }

    public function test_a_person_report_must_name_the_other_person_on_that_errand(): void
    {
        $stranger = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        // Yourself.
        $this->report($this->customer, [
            'category' => 'report_user', 'booking_id' => $this->booking->id, 'reported_user_id' => $this->customer->id,
        ])->assertStatus(422)->assertJsonValidationErrors(['reported_user_id']);

        // Someone who was never on the errand.
        $this->report($this->customer, [
            'category' => 'report_user', 'booking_id' => $this->booking->id, 'reported_user_id' => $stranger->id,
        ])->assertStatus(422)->assertJsonValidationErrors(['reported_user_id']);

        // No one / no errand.
        $this->report($this->customer, ['category' => 'report_user', 'booking_id' => $this->booking->id])
            ->assertStatus(422)->assertJsonValidationErrors(['reported_user_id']);
        $this->report($this->customer, ['category' => 'report_user', 'reported_user_id' => $this->runner->id])
            ->assertStatus(422)->assertJsonValidationErrors(['booking_id']);

        // Naming someone on an ordinary ticket.
        $this->report($this->customer, [
            'category' => 'other', 'booking_id' => $this->booking->id, 'reported_user_id' => $this->runner->id,
        ])->assertStatus(422)->assertJsonValidationErrors(['reported_user_id']);

        $this->assertSame(0, SupportTicket::count());
    }

    public function test_staff_can_filter_for_reports_about_a_person_and_see_who(): void
    {
        $this->report($this->customer, [
            'category' => 'report_user', 'booking_id' => $this->booking->id, 'reported_user_id' => $this->runner->id,
            'subject' => 'Rude runner',
        ])->assertCreated();
        $this->report($this->customer, ['booking_id' => $this->booking->id, 'category' => 'payment', 'subject' => 'Charged twice'])
            ->assertCreated();

        $report = SupportTicket::where('category', 'report_user')->firstOrFail();
        $other = SupportTicket::where('category', 'payment')->firstOrFail();

        $admin = AdminUser::forceCreate([
            'email' => 'support@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Support', 'role' => 'support', 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
        $this->actingAs($admin, 'admin');

        Livewire::test(ListSupportTickets::class, ['activeTab' => 'all'])
            ->filterTable('reports', true)
            ->assertCanSeeTableRecords([$report])
            ->assertCanNotSeeTableRecords([$other]);

        $this->get("/admin/support-tickets/{$report->id}/view")
            ->assertOk()
            ->assertSee('Reported person')
            ->assertSee('Jun Cruz');
    }
}
