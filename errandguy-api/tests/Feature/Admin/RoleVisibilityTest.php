<?php

namespace Tests\Feature\Admin;

use App\Filament\Pages\Payouts;
use App\Filament\Resources\Bookings\Pages\ListBookings;
use App\Filament\Resources\Bookings\Widgets\BookingListStats;
use App\Filament\Resources\RunnerProfiles\Pages\ListRunnerProfiles;
use App\Filament\Resources\Users\Pages\ListUsers;
use App\Filament\Resources\WalletTransactions\Pages\ListWalletTransactions;
use App\Filament\Widgets\ActionQueue;
use App\Filament\Widgets\LiveAlertsWidget;
use App\Filament\Widgets\TopRunners;
use App\Models\AdminAlert;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\StaffMoneyLimit;
use App\Support\AdminCache;
use App\Support\JobFailureReporter;
use Filament\Widgets\StatsOverviewWidget\Stat;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Who sees what: CSV exports with phone numbers, emails or wallet data are for
 * super admins and admins; GMV, revenue and runner earnings are for money
 * roles; dashboard cards and alerts link only to pages the viewer can open;
 * and a background task that failed for good shows red.
 */
class RoleVisibilityTest extends TestCase
{
    use RefreshDatabase;

    private function as(string $role): AdminUser
    {
        $staff = AdminUser::firstOrCreate(['email' => "{$role}@errandguy.test"], [
            'password_hash' => 'x', 'full_name' => ucfirst($role), 'role' => $role, 'is_active' => true,
        ]);
        $this->actingAs($staff, 'admin');

        return $staff;
    }

    /** @return array<string, Stat> */
    private function stats(object $widget): array
    {
        AdminCache::flush();

        return collect((fn () => $this->getStats())->call($widget))
            ->mapWithKeys(fn (Stat $s): array => [(string) $s->getLabel() => $s])
            ->all();
    }

    public function test_personal_data_exports_are_for_super_admins_and_admins_only(): void
    {
        foreach (['super_admin', 'admin'] as $role) {
            $this->as($role);
            Livewire::test(ListUsers::class)->assertTableActionVisible('exportCsv');
            Livewire::test(ListRunnerProfiles::class)->assertTableActionVisible('exportCsv');
        }

        foreach (['finance', 'support', 'ops'] as $role) {
            $this->as($role);
            Livewire::test(ListUsers::class)
                ->assertTableActionHidden('exportCsv')
                ->assertTableBulkActionHidden('exportSelectedCsv');
            Livewire::test(ListRunnerProfiles::class)->assertTableActionHidden('exportCsv');
        }

        // The wallet ledger is a money page with no contact details: the money
        // roles that can open it can export it for reconciliation.
        $this->as('finance');
        Livewire::test(ListWalletTransactions::class)->assertTableActionVisible('exportCsv');
        $this->as('super_admin');
        Livewire::test(ListWalletTransactions::class)->assertTableActionVisible('exportCsv');

        // Exports without personal data stay open to every role.
        $this->as('support');
        Livewire::test(ListBookings::class)->assertTableActionVisible('exportCsv');
    }

    public function test_gmv_is_hidden_from_non_money_roles_on_the_errand_list(): void
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'is_active' => true, 'sort_order' => 1,
        ]);
        Booking::create([
            'booking_number' => 'EG-GMV-1', 'customer_id' => $customer->id, 'errand_type_id' => $type->id,
            'status' => 'completed', 'payment_status' => 'paid',
            'pickup_address' => 'A', 'pickup_lat' => 14.6, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15, 'surcharge' => 0,
            'total_amount' => 115, 'runner_payout' => 85, 'is_transportation' => false, 'completed_at' => now(),
        ]);

        foreach (['admin', 'support', 'ops'] as $role) {
            $this->as($role);
            $this->assertArrayNotHasKey('GMV today', $this->stats(new BookingListStats));
            Livewire::test(ListBookings::class)->assertDontSee('Total GMV');
        }

        foreach (['super_admin', 'finance'] as $role) {
            $this->as($role);
            $this->assertArrayHasKey('GMV today', $this->stats(new BookingListStats));
            Livewire::test(ListBookings::class)->assertSee('Total GMV');
        }
    }

    public function test_runner_earnings_are_hidden_from_non_money_roles(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'full_name' => 'Runner Rich']);
        RunnerProfile::create([
            'user_id' => $runner->id, 'verification_status' => 'approved', 'is_online' => true,
            'preferred_types' => [], 'completion_rate' => 100.00, 'total_errands' => 9, 'total_earnings' => 98765.43,
        ]);

        $this->as('support');
        Livewire::test(TopRunners::class)->assertSee('Runner Rich')->assertDontSee('Lifetime earnings')->assertDontSee('98,765.43');
        Livewire::test(ListRunnerProfiles::class)->assertDontSee('98,765.43');

        $this->as('finance');
        Livewire::test(TopRunners::class)->assertSee('Lifetime earnings')->assertSee('98,765.43');
    }

    public function test_a_permanently_failed_background_task_shows_as_a_red_error(): void
    {
        JobFailureReporter::report('App\\Jobs\\SendPushJob', 'Timed out');

        $alert = AdminAlert::where('type', 'job_failed')->sole();
        $this->assertSame('error', $alert->severity);
        $this->assertSame('danger', LiveAlertsWidget::severityColor('error'));
        $this->assertSame('danger', LiveAlertsWidget::severityColor('critical'));
        $this->assertSame('warning', LiveAlertsWidget::severityColor('warning'));

        $this->as('support');
        Livewire::test(LiveAlertsWidget::class)->assertSee('Background job failed: SendPushJob')->assertSee('Error');
    }

    public function test_alerts_link_only_to_pages_the_viewer_can_open(): void
    {
        AdminAlert::raise('payout_reconciled', 'warning', 'Payout settled late');
        AdminAlert::raise('sos', 'critical', 'SOS raised', null, (string) Str::uuid());
        $payout = AdminAlert::where('type', 'payout_reconciled')->sole();
        $sos = AdminAlert::where('type', 'sos')->sole();

        $this->as('support');
        $this->assertNull(LiveAlertsWidget::linkFor($payout));
        $this->assertNotNull(LiveAlertsWidget::linkFor($sos));

        $this->as('finance');
        $this->assertSame(Payouts::getUrl(), LiveAlertsWidget::linkFor($payout));
        $this->assertNull(LiveAlertsWidget::linkFor($sos));
    }

    public function test_alerts_that_need_action_are_one_click_away_and_only_the_people_who_act_can_dismiss_them(): void
    {
        $bookingId = (string) Str::uuid();
        AdminAlert::raise('runner_suspended_mid_errand', 'critical', 'Runner suspended mid-errand', null, $bookingId);
        AdminAlert::raise('completed_unpaid_booking', 'critical', 'Completed, unpaid', null, $bookingId);
        AdminAlert::raise('kyc_resubmitted', 'info', 'New documents', null, (string) Str::uuid());
        $suspended = AdminAlert::where('type', 'runner_suspended_mid_errand')->sole();
        $unpaid = AdminAlert::where('type', 'completed_unpaid_booking')->sole();
        $kyc = AdminAlert::where('type', 'kyc_resubmitted')->sole();

        $this->as('ops');
        $this->assertStringContainsString($bookingId, (string) LiveAlertsWidget::linkFor($suspended));
        $this->assertNotNull(LiveAlertsWidget::linkFor($kyc));
        $this->assertTrue(LiveAlertsWidget::canDismiss($suspended));
        // A money alert stays up until finance has seen it.
        $this->assertFalse(LiveAlertsWidget::canDismiss($unpaid));

        $this->as('finance');
        $this->assertTrue(LiveAlertsWidget::canDismiss($unpaid));
    }

    public function test_alerts_about_staff_moving_money_are_for_money_roles(): void
    {
        AdminAlert::raise(StaffMoneyLimit::ALERT_ADJUSTMENT, 'warning', 'Large wallet adjustment: +₱8,000.00');
        AdminAlert::raise('no_runner', 'warning', 'No runner found');
        $money = AdminAlert::where('type', StaffMoneyLimit::ALERT_ADJUSTMENT)->get();
        $ops = AdminAlert::where('type', 'no_runner')->get();

        $this->as('support');
        Livewire::test(LiveAlertsWidget::class)->assertCanSeeTableRecords($ops)->assertCanNotSeeTableRecords($money);

        $this->as('finance');
        Livewire::test(LiveAlertsWidget::class)->assertCanSeeTableRecords($money);
    }

    public function test_dashboard_cards_link_only_where_the_viewer_can_go(): void
    {
        $this->as('support');
        $cards = $this->stats(new ActionQueue);
        $this->assertArrayNotHasKey('Pending payouts', $cards, 'the payout queue is money staff’s work');
        $this->assertNotNull($cards['Active SOS']->getUrl());
        $this->assertNotNull($cards['Waiting on us']->getUrl());

        $this->as('finance');
        $cards = $this->stats(new ActionQueue);
        $this->assertSame(Payouts::getUrl(), $cards['Pending payouts']->getUrl());
        $this->assertNull($cards['Active SOS']->getUrl(), 'finance can’t open SOS alerts, so the card is not a link');
        $this->assertNull($cards['Waiting on us']->getUrl());
        $this->assertNotNull($cards['Stuck errands']->getUrl());
    }
}
