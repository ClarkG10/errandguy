<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\Users\Pages\ViewUser;
use App\Models\AdminAlert;
use App\Models\AdminUser;
use App\Models\SystemConfig;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\StaffMoneyLimit;
use App\Services\WalletService;
use App\Support\PayoutDestination;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Insider limits on money staff move by hand: each staff member can move at
 * most admin_adjustment_daily_cap (₱20,000) a Manila day across wallet
 * adjustments and "Pay a runner" payouts, and any single move of
 * admin_adjustment_alert_threshold (₱5,000) or more raises a dashboard alert.
 */
class StaffMoneyLimitTest extends TestCase
{
    use RefreshDatabase;

    private WalletService $wallet;

    private AdminUser $finance;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();

        // 11:00 on Oct 31 in Manila.
        $this->travelTo(Carbon::parse('2026-10-31 03:00:00', 'UTC'));

        $this->wallet = app(WalletService::class);
        $this->finance = $this->staff('finance');
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active', 'wallet_balance' => 0, 'full_name' => 'Juan Cruz']);
    }

    private function staff(string $role, ?string $email = null): AdminUser
    {
        return AdminUser::create([
            'email' => $email ?? "{$role}@errandguy.test", 'password_hash' => 'x',
            'full_name' => ucfirst($role).' Staff', 'role' => $role, 'is_active' => true,
        ]);
    }

    public function test_the_defaults_come_from_the_settings(): void
    {
        $this->assertSame(20000.0, StaffMoneyLimit::dailyCap());
        $this->assertSame(5000.0, StaffMoneyLimit::alertThreshold());

        SystemConfig::setValue('admin_adjustment_daily_cap', '30000');
        $this->assertSame(30000.0, StaffMoneyLimit::dailyCap());

        // A broken value falls back to the default rather than lifting the limit.
        SystemConfig::setValue('admin_adjustment_daily_cap', 'lots');
        $this->assertSame(20000.0, StaffMoneyLimit::dailyCap());
    }

    public function test_adjustments_over_the_daily_cap_are_refused_and_leave_the_wallet_alone(): void
    {
        $this->wallet->adjust($this->finance, $this->customer->id, 10000, 'Refund for lost item');
        $this->wallet->adjust($this->finance, $this->customer->id, -2000, 'Correction');
        $this->wallet->adjust($this->finance, $this->customer->id, 7000, 'Goodwill');
        // 10,000 + 2,000 (a debit counts too) + 7,000 = 19,000 moved today.
        $this->assertSame(19000.0, StaffMoneyLimit::movedToday($this->finance));
        $this->assertSame(1000.0, StaffMoneyLimit::remainingToday($this->finance));

        try {
            $this->wallet->adjust($this->finance, $this->customer->id, 1500, 'One more');
            $this->fail('the daily cap must stop this adjustment');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('daily limit of ₱20,000.00', $e->getMessage());
        }

        $this->assertSame(15000.0, (float) $this->customer->fresh()->wallet_balance);
        $this->assertSame(3, WalletTransaction::where('type', 'adjustment')->count());
        $this->assertSame(3, WalletTransaction::where('initiated_by_staff_id', $this->finance->id)->count());

        // The cap is per staff member.
        $this->wallet->adjust($this->staff('super_admin'), $this->customer->id, 1500, 'Approved by owner');
        $this->assertSame(16500.0, (float) $this->customer->fresh()->wallet_balance);
    }

    public function test_the_cap_resets_at_manila_midnight(): void
    {
        $this->wallet->adjust($this->finance, $this->customer->id, 10000, 'One');
        $this->wallet->adjust($this->finance, $this->customer->id, 10000, 'Two');
        $this->assertSame(0.0, StaffMoneyLimit::remainingToday($this->finance));

        // 23:59 Manila the same day: still today.
        $this->travelTo(Carbon::parse('2026-10-31 15:59:00', 'UTC'));
        $this->assertSame(0.0, StaffMoneyLimit::remainingToday($this->finance));

        // 00:01 Manila on Nov 1 (still Oct 31 in UTC): a new day.
        $this->travelTo(Carbon::parse('2026-10-31 16:01:00', 'UTC'));
        $this->assertSame(20000.0, StaffMoneyLimit::remainingToday($this->finance));
        $this->wallet->adjust($this->finance, $this->customer->id, 500, 'Next day');
    }

    public function test_a_large_adjustment_raises_an_alert_and_a_small_one_does_not(): void
    {
        $this->customer->update(['wallet_balance' => 6000]);

        $this->wallet->adjust($this->finance, $this->customer->id, 4999.99, 'Small');
        $this->assertSame(0, AdminAlert::count());

        // A debit is as much a hand-made money move as a credit.
        $this->wallet->adjust($this->finance, $this->customer->id, -5000, 'Reversal');

        $alert = AdminAlert::sole();
        $this->assertSame(StaffMoneyLimit::ALERT_ADJUSTMENT, $alert->type);
        $this->assertSame($this->customer->id, $alert->subject_id);
        $this->assertStringContainsString('₱5,000.00', $alert->title);
        $this->assertStringContainsString('Juan Cruz', $alert->body);
        $this->assertStringContainsString('Finance Staff', $alert->body);
    }

    public function test_pay_a_runner_counts_toward_the_cap_alerts_and_is_never_counted_twice(): void
    {
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 30000, 'full_name' => 'Rhea Runner']);
        $destination = PayoutDestination::make('gcash', '09171234567', 'Rhea Runner', channelCode: 'PH_GCASH');

        $this->wallet->adjust($this->finance, $this->customer->id, 10000, 'Refund');
        $payout = $this->wallet->payout($this->finance, $runner->id, 6000, 'idem-1', $destination);

        $this->assertSame($this->finance->id, $payout->initiated_by_staff_id);
        $this->assertSame(16000.0, StaffMoneyLimit::movedToday($this->finance));

        $alert = AdminAlert::where('type', StaffMoneyLimit::ALERT_PAYOUT)->sole();
        $this->assertSame($payout->id, $alert->subject_id);
        $this->assertStringContainsString('Rhea Runner', $alert->body);

        // A double-submit of the same payout returns it without counting or alerting again.
        $again = $this->wallet->payout($this->finance, $runner->id, 6000, 'idem-1', $destination);
        $this->assertSame($payout->id, $again->id);
        $this->assertSame(16000.0, StaffMoneyLimit::movedToday($this->finance));
        $this->assertSame(1, AdminAlert::where('type', StaffMoneyLimit::ALERT_PAYOUT)->count());

        // A new payout over what's left is refused before any money moves.
        try {
            $this->wallet->payout($this->finance, $runner->id, 5000, 'idem-2', $destination);
            $this->fail('the daily cap must stop this payout');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('daily limit', $e->getMessage());
        }
        $this->assertSame(24000.0, (float) $runner->fresh()->wallet_balance);
    }

    /**
     * Static guard (a single-threaded test can't race two requests): each
     * staff money move takes the staff row lock before reading anything, so
     * on MySQL the day's total it checks includes every move already made.
     */
    public function test_the_staff_lock_comes_before_any_read(): void
    {
        $source = function (string $class, string $method): string {
            $m = new \ReflectionMethod($class, $method);

            return implode('', array_slice(file($m->getFileName()), $m->getStartLine() - 1, $m->getEndLine() - $m->getStartLine() + 1));
        };

        $adjust = $source(WalletService::class, 'adjust');
        $this->assertLessThan(strpos($adjust, 'User::lockForUpdate()'), strpos($adjust, 'StaffMoneyLimit::assertWithinDailyCap'));

        $payout = $source(WalletService::class, 'payout');
        $this->assertLessThan(strpos($payout, "where('reference_id'"), strpos($payout, 'StaffMoneyLimit::lockStaff'));
        $this->assertLessThan(strpos($payout, 'createPendingPayout('), strpos($payout, 'StaffMoneyLimit::assertWithinDailyCap'));

        $this->assertStringContainsString('lockForUpdate()', $source(StaffMoneyLimit::class, 'lockStaff'));
        $this->assertStringContainsString('self::lockStaff($staff)', $source(StaffMoneyLimit::class, 'assertWithinDailyCap'));
    }

    public function test_who_moved_the_money_never_reaches_the_app(): void
    {
        $tx = $this->wallet->adjust($this->finance, $this->customer->id, 100, 'Goodwill');

        $this->assertArrayNotHasKey('initiated_by_staff_id', $tx->toArray());
    }

    public function test_the_adjust_wallet_action_charges_the_signed_in_staff_member(): void
    {
        $this->actingAs($this->finance, 'admin');

        Livewire::test(ViewUser::class, ['record' => $this->customer->id])
            ->callAction('adjustWallet', ['direction' => 'credit', 'amount' => 250, 'reason' => 'Late errand'])
            ->assertHasNoActionErrors();

        $this->assertSame($this->finance->id, WalletTransaction::where('type', 'adjustment')->sole()->initiated_by_staff_id);
        $this->assertSame(250.0, (float) $this->customer->fresh()->wallet_balance);
    }
}
