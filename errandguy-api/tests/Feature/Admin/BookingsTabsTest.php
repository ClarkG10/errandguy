<?php

namespace Tests\Feature\Admin;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Reproduces the reported "Error while loading page" on the Bookings list
 * tabs/filters by rendering the real admin panel routes — including the exact
 * `?tab=completed` URL from the report. Filament hydrates the active tab (and
 * table filters) from the query string on a GET and applies each tab's
 * modifyQueryUsing, so a server-side render exercises the same code path a
 * Livewire tab switch does. A thrown exception yields a non-200 → assertOk fails.
 */
class BookingsTabsTest extends TestCase
{
    use RefreshDatabase;

    private const URL = '/admin/bookings';

    protected function setUp(): void
    {
        parent::setUp();

        $admin = AdminUser::forceCreate([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'admin', 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
        $this->actingAs($admin, 'admin');

        // One booking per triage bucket so every tab has rows to render.
        $this->seedBooking('DONE', 'completed');
        $this->seedBooking('CXL', 'cancelled');
        $this->seedBooking('LIVE', 'accepted');
    }

    private function seedBooking(string $suffix, string $status): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create([
            'booking_number' => 'EG-TAB-'.$suffix,
            'customer_id' => $customer->id,
            'errand_type_id' => $type->id,
            'status' => $status,
            'payment_status' => $status === 'completed' ? 'paid' : 'unpaid',
            'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
            'completed_at' => $status === 'completed' ? now() : null,
        ]);
    }

    public function test_the_errand_page_links_the_people_and_the_payment(): void
    {
        $booking = $this->seedBooking('VIEW', 'accepted');
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'phone' => '+639171112222', 'full_name' => 'Rhea Runner']);
        $booking->update(['runner_id' => $runner->id]);
        \App\Models\Payment::create([
            'booking_id' => $booking->id, 'customer_id' => $booking->customer_id,
            'amount' => 115, 'method' => 'gcash', 'status' => 'completed', 'paid_at' => now(),
        ]);
        \App\Models\Message::create([
            'booking_id' => $booking->id, 'sender_id' => $runner->id, 'content' => 'On my way',
        ]);

        // Ops: can call and open the runner, but the payment record is finance's.
        $this->actingAs(AdminUser::forceCreate([
            'email' => 'ops2@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops Two', 'role' => 'ops', 'is_active' => true,
            'has_email_authentication' => true,
        ]), 'admin');
        $this->get(\App\Filament\Resources\Bookings\BookingResource::getUrl('view', ['record' => $booking]))
            ->assertOk()
            ->assertSee('tel:+639171112222', false)
            ->assertSee('Rhea Runner')
            ->assertDontSee('Open payment');

        // A new staff member, a new session (the panel ties a session to the
        // password of whoever opened it).
        $this->flushSession();
        $this->actingAs(AdminUser::forceCreate([
            'email' => 'fin@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Fin', 'role' => 'finance', 'is_active' => true,
            'has_email_authentication' => true,
        ]), 'admin');
        $this->get(\App\Filament\Resources\Bookings\BookingResource::getUrl('view', ['record' => $booking]))->assertOk()->assertSee('Open payment');
    }

    public function test_bookings_index_renders(): void
    {
        $this->get(self::URL)->assertOk();
    }

    public function test_total_gmv_summary_counts_only_completed_bookings(): void
    {
        // setUp seeded completed(115) + cancelled(115) + accepted(115). GMV is
        // completed-only (matching every other GMV surface), so the footer must
        // be 115 — not 345, which would count the cancelled + in-flight money
        // that was never transacted.
        \Livewire\Livewire::test(\App\Filament\Resources\Bookings\Pages\ListBookings::class)
            ->assertTableColumnSummarySet('total_amount', 'gmv', 115);
    }

    public function test_every_triage_tab_renders_without_error(): void
    {
        // The exact URL from the bug report, plus the other tabs.
        $this->get(self::URL.'?tab=completed')->assertOk();
        $this->get(self::URL.'?tab=cancelled')->assertOk();
        $this->get(self::URL.'?tab=active')->assertOk();
        $this->get(self::URL.'?tab=all')->assertOk();
    }

    public function test_status_filter_renders_without_error(): void
    {
        $this->get(self::URL.'?filters[status][value]=completed')->assertOk();
        $this->get(self::URL.'?filters[payment_status][value]=unpaid')->assertOk();
    }

    public function test_the_dashboard_deep_link_actually_filters_the_list(): void
    {
        // Filament reads table filters from ?filters=…; the dashboard cards and
        // the status chart used ?tableFilters=…, which was silently ignored, so
        // "Stuck errands: 3" opened every booking. Render the exact URL the
        // card builds and check only the counted rows come back.
        $this->seedBooking('STUCK', 'no_runner');

        $url = \App\Filament\Resources\Bookings\BookingResource::getUrl('index', ['filters' => ['status' => ['value' => 'no_runner']]]);

        $this->get($url)
            ->assertOk()
            ->assertSee('EG-TAB-STUCK')
            ->assertDontSee('EG-TAB-DONE')
            ->assertDontSee('EG-TAB-LIVE');
    }
}
