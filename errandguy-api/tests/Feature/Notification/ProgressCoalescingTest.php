<?php

namespace Tests\Feature\Notification;

use App\Models\Notification;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Progress streams must leave ONE card in the inbox, not one per tick.
 *
 * The shopping checklist is ticked item by item and each tick called
 * notifyInApp, which persists a row — so a 40-item list dropped 40 identical
 * "Shopping list updated" cards into the customer's Alerts inbox and buried
 * everything that actually needed attention. The intent was always the live
 * broadcast (the tracking screen patches its checklist from the payload); the
 * rows were a side effect of the delivery mechanism.
 *
 * Deliberately ONE row rather than none: the inbox already types and
 * categorises these as "Shopping", and a customer who was away does want to
 * know the list moved — once, showing the latest state.
 */
class ProgressCoalescingTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private NotificationService $notifications;

    protected function setUp(): void
    {
        parent::setUp();
        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->notifications = app(NotificationService::class);
    }

    private function tick(string $bookingId, int $done): Notification
    {
        return $this->notifications->notifyInAppCoalesced(
            $this->customer->id,
            'Shopping list updated',
            'Your runner updated the shopping checklist.',
            [
                'type' => 'shopping_items_updated',
                'booking_id' => $bookingId,
                'shopping_items' => ['done' => $done],
            ],
        );
    }

    public function test_forty_ticks_leave_one_card_not_forty(): void
    {
        for ($i = 1; $i <= 40; $i++) {
            $this->tick('bk-1', $i);
        }

        $this->assertSame(1, Notification::where('user_id', $this->customer->id)->count());
    }

    public function test_the_surviving_card_shows_the_LATEST_state(): void
    {
        $this->tick('bk-1', 1);
        $this->tick('bk-1', 7);

        $row = Notification::where('user_id', $this->customer->id)->firstOrFail();
        // Stale contents would be worse than many cards — the customer would be
        // reading item 1 of 40 while the runner is on item 7.
        $this->assertSame(['done' => 7], $row->data['shopping_items']);
    }

    /**
     * Two errands running at once are two separate subjects. Collapsing them
     * would hide one errand's progress behind the other's.
     */
    public function test_separate_errands_keep_separate_cards(): void
    {
        $this->tick('bk-1', 1);
        $this->tick('bk-2', 1);
        $this->tick('bk-1', 2);

        $this->assertSame(2, Notification::where('user_id', $this->customer->id)->count());
    }

    /**
     * The inbox sorts by created_at, so leaving it alone would refresh the
     * card's contents while it stayed buried wherever it first landed.
     */
    public function test_the_card_resurfaces_and_is_unread_again(): void
    {
        $first = $this->tick('bk-1', 1);
        Notification::whereKey($first->id)->update([
            'is_read' => true,
            'created_at' => now()->subHours(3),
        ]);

        $this->tick('bk-1', 2);

        $row = Notification::whereKey($first->id)->firstOrFail();
        $this->assertFalse((bool) $row->is_read);
        $this->assertTrue($row->created_at->gt(now()->subMinute()));
    }

    /**
     * A different notification type about the same booking is a different
     * message — a status change must never be overwritten by a checklist tick.
     */
    public function test_it_never_swallows_a_different_type(): void
    {
        $this->notifications->notifyInApp(
            $this->customer->id,
            'Runner arrived',
            'Your runner has arrived at the pickup location.',
            ['type' => 'booking_update', 'booking_id' => 'bk-1'],
        );

        $this->tick('bk-1', 1);

        $this->assertSame(2, Notification::where('user_id', $this->customer->id)->count());
        $this->assertDatabaseHas('notifications', [
            'user_id' => $this->customer->id,
            'title' => 'Runner arrived',
        ]);
    }

    /**
     * No subject to coalesce on must DEGRADE to a normal notification, never
     * silently drop it.
     */
    public function test_a_payload_without_a_booking_id_still_notifies(): void
    {
        $this->notifications->notifyInAppCoalesced(
            $this->customer->id,
            'Shopping list updated',
            'Your runner updated the shopping checklist.',
            ['type' => 'shopping_items_updated'],
        );

        $this->assertSame(1, Notification::where('user_id', $this->customer->id)->count());
    }

    /**
     * An archived card is one the customer has cleared away. Reviving it would
     * resurrect something they deliberately dismissed.
     */
    public function test_an_archived_card_is_not_revived(): void
    {
        $first = $this->tick('bk-1', 1);
        Notification::whereKey($first->id)->update(['archived_at' => now()]);

        $this->tick('bk-1', 2);

        $this->assertSame(2, Notification::where('user_id', $this->customer->id)->count());
        $this->assertNotNull(Notification::whereKey($first->id)->value('archived_at'));
    }

    public function test_it_does_not_coalesce_across_users(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $this->tick('bk-1', 1);
        $this->notifications->notifyInAppCoalesced(
            $other->id,
            'Shopping list updated',
            'Your runner updated the shopping checklist.',
            ['type' => 'shopping_items_updated', 'booking_id' => 'bk-1', 'shopping_items' => ['done' => 1]],
        );

        $this->assertSame(1, Notification::where('user_id', $this->customer->id)->count());
        $this->assertSame(1, Notification::where('user_id', $other->id)->count());
    }
}
