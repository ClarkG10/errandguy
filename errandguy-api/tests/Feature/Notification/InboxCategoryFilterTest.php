<?php

namespace Tests\Feature\Notification;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The inbox category chips must mean what they say.
 *
 * They are coarse groupings over several `type` values, and they used to filter
 * the rows the app had already loaded — page one only. So a customer with a
 * busy inbox could tap "Payments" and read "No payment notifications yet" while
 * their payment rows sat unfetched on page three. Filtering server-side makes
 * the chip honest and keeps pagination correct inside a category.
 */
class InboxCategoryFilterTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    private function notify(string $type, string $title, int $minutesAgo = 0): Notification
    {
        $n = Notification::create([
            'user_id' => $this->user->id,
            'type' => $type,
            'title' => $title,
            'body' => 'b',
            'is_read' => false,
        ]);
        // created_at is not fillable on Notification.
        $n->forceFill(['created_at' => now()->subMinutes($minutesAgo)])->save();

        return $n;
    }

    /** @return list<string> titles returned, in order */
    private function inbox(?string $types = null, int $perPage = 20): array
    {
        $url = '/api/v1/notifications?per_page='.$perPage
            .($types !== null ? '&types='.urlencode($types) : '');

        return collect($this->actingAs($this->user)->getJson($url)->assertOk()->json('data'))
            ->pluck('title')->all();
    }

    /**
     * The exact bug: the only payment row is old enough to be well past page
     * one, so a client-side filter over the loaded page could never see it.
     */
    public function test_a_payment_row_beyond_page_one_is_found(): void
    {
        for ($i = 0; $i < 30; $i++) {
            $this->notify('booking_update', "booking {$i}", $i);
        }
        $this->notify('payment', 'Payout sent', 500);

        $this->assertSame(['Payout sent'], $this->inbox('payment,referral'));
    }

    public function test_a_category_returns_every_type_in_its_group(): void
    {
        $this->notify('booking_update', 'status moved', 3);
        $this->notify('shopping_items_updated', 'list moved', 2);
        $this->notify('booking_stops_updated', 'stop done', 1);
        $this->notify('promo', 'not this one', 0);

        $this->assertSame(
            ['stop done', 'list moved', 'status moved'],
            $this->inbox('booking_update,shopping_items_updated,booking_stops_updated'),
        );
    }

    public function test_no_filter_still_returns_everything(): void
    {
        $this->notify('payment', 'a', 1);
        $this->notify('promo', 'b', 0);

        $this->assertSame(['b', 'a'], $this->inbox());
    }

    /**
     * A newer client may send a type this build has never heard of. It should
     * get a narrower list, not a validation error.
     */
    public function test_an_unknown_type_narrows_rather_than_failing(): void
    {
        $this->notify('payment', 'real', 0);

        $this->assertSame([], $this->inbox('some_future_type'));
        $this->assertSame(['real'], $this->inbox('some_future_type,payment'));
    }

    public function test_filtering_never_leaks_another_users_notifications(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        Notification::create([
            'user_id' => $other->id, 'type' => 'payment',
            'title' => 'theirs', 'body' => 'b', 'is_read' => false,
        ]);

        $this->assertSame([], $this->inbox('payment'));
    }

    /**
     * Archived rows are ones the customer cleared away; a category chip must
     * not resurrect them.
     */
    public function test_filtering_does_not_resurface_archived_rows(): void
    {
        $archived = $this->notify('payment', 'cleared away', 1);
        $archived->forceFill(['archived_at' => now()])->save();
        $this->notify('payment', 'still here', 0);

        $this->assertSame(['still here'], $this->inbox('payment'));
    }
}
