<?php

namespace Tests\Feature\Admin;

use App\Filament\Pages\Payouts;
use App\Models\AdminUser;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * The payout queue is work, and work is served oldest-first.
 *
 * The table defaulted to created_at DESC, so the runner who had been waiting
 * longest for their own money sat at the very bottom and was served last — the
 * same defect already fixed on the dispute queues. Settled rows keep
 * newest-first underneath, because for those this page is a ledger being
 * browsed rather than a queue being worked.
 */
class PayoutQueueOrderTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->actingAs(AdminUser::create([
            'email' => 'finance@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Finance', 'role' => 'finance', 'is_active' => true,
        ]), 'admin');
    }

    private function payout(string $status, int $daysAgo, float $amount): WalletTransaction
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $tx = WalletTransaction::create([
            'user_id' => $user->id,
            'type' => 'payout',
            'amount' => -$amount,
            'balance_after' => 0,
            'description' => 'Payout request',
            'status' => $status,
        ]);
        // created_at is not fillable on WalletTransaction — mass-assigning it is
        // silently dropped, and these tests are entirely about created_at order.
        $tx->forceFill(['created_at' => now()->subDays($daysAgo)])->save();

        return $tx->refresh();
    }

    /**
     * Row ids in the order the page actually renders them.
     *
     * Asserted against the component's own records rather than id-matching in
     * rendered HTML: the markup repeats each id in checkboxes and action
     * buttons, which makes an "in order" match on HTML unreliable.
     *
     * getTableRecords() returns a Paginator here, and collect() on a paginator
     * wraps the OBJECT rather than its rows — hence the explicit items().
     *
     * @return list<string>
     */
    private function renderedIds(?string $status = 'pending'): array
    {
        $component = Livewire::test(Payouts::class);
        // The page ships a status filter defaulting to 'pending', so the queue
        // is pending-only unless an admin clears it. Pass null to assert the
        // cross-status ordering an admin sees when they do.
        if ($status === null) {
            $component->filterTable('status', null);
        }

        $records = $component->instance()->getTableRecords();
        $items = method_exists($records, 'items') ? $records->items() : $records->all();

        return collect($items)->pluck('id')->values()->all();
    }

    public function test_the_longest_waiting_runner_is_at_the_top(): void
    {
        $newest = $this->payout('pending', 1, 100);
        $oldest = $this->payout('pending', 9, 300);
        $middle = $this->payout('pending', 4, 200);

        $this->assertSame([$oldest->id, $middle->id, $newest->id], $this->renderedIds());
    }

    /**
     * The default view IS the work queue — a settled payout must not appear in
     * it at all, which is what makes oldest-first the right default.
     */
    public function test_the_default_view_is_the_pending_queue_only(): void
    {
        $this->payout('completed', 0, 500);
        $pendingLastWeek = $this->payout('pending', 7, 250);

        $this->assertSame([$pendingLastWeek->id], $this->renderedIds());
    }

    /**
     * With the filter cleared, pending is still work and history is still
     * history — an admin looking at everything should see who is owed money
     * first, not the most recent completed transfer.
     */
    public function test_pending_work_outranks_settled_history_when_showing_all(): void
    {
        $settledToday = $this->payout('completed', 0, 500);
        $pendingLastWeek = $this->payout('pending', 7, 250);

        $this->assertSame(
            [$pendingLastWeek->id, $settledToday->id],
            $this->renderedIds(null),
        );
    }

    public function test_settled_rows_stay_newest_first_beneath_the_queue(): void
    {
        $pending = $this->payout('pending', 3, 100);
        $olderSettled = $this->payout('completed', 20, 200);
        $newerSettled = $this->payout('completed', 2, 300);

        $this->assertSame(
            [$pending->id, $newerSettled->id, $olderSettled->id],
            $this->renderedIds(null),
        );
    }
}
