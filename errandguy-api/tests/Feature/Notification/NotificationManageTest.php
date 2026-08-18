<?php

namespace Tests\Feature\Notification;

use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationManageTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    private function makeNotification(User $owner, array $overrides = []): Notification
    {
        return Notification::create(array_merge([
            'user_id' => $owner->id,
            'title' => 'Test',
            'body' => 'Test body',
            'type' => 'system',
            'is_read' => false,
        ], $overrides));
    }

    public function test_user_can_delete_own_notification(): void
    {
        $notification = $this->makeNotification($this->user);

        $this->actingAs($this->user)
            ->deleteJson("/api/v1/notifications/{$notification->id}")
            ->assertOk()
            ->assertJsonPath('message', 'Notification deleted.');

        $this->assertDatabaseMissing('notifications', ['id' => $notification->id]);
    }

    public function test_user_cannot_delete_others_notification(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $notification = $this->makeNotification($other);

        $this->actingAs($this->user)
            ->deleteJson("/api/v1/notifications/{$notification->id}")
            ->assertStatus(404);

        $this->assertDatabaseHas('notifications', ['id' => $notification->id]);
    }

    public function test_archive_hides_notification_from_default_index(): void
    {
        $active = $this->makeNotification($this->user);
        $toArchive = $this->makeNotification($this->user);

        $this->actingAs($this->user)
            ->putJson("/api/v1/notifications/{$toArchive->id}/archive")
            ->assertOk();

        $response = $this->actingAs($this->user)
            ->getJson('/api/v1/notifications')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($active->id, $ids);
        $this->assertNotContains($toArchive->id, $ids);

        // Archived-only view surfaces it.
        $archivedResponse = $this->actingAs($this->user)
            ->getJson('/api/v1/notifications?archived=1')
            ->assertOk();

        $archivedIds = collect($archivedResponse->json('data'))->pluck('id')->all();
        $this->assertContains($toArchive->id, $archivedIds);
        $this->assertNotContains($active->id, $archivedIds);
    }

    public function test_unarchive_restores_notification_to_default_index(): void
    {
        $notification = $this->makeNotification($this->user, ['archived_at' => now()]);

        $this->actingAs($this->user)
            ->putJson("/api/v1/notifications/{$notification->id}/unarchive")
            ->assertOk();

        $response = $this->actingAs($this->user)
            ->getJson('/api/v1/notifications')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($notification->id, $ids);
    }

    public function test_unread_count_excludes_archived_notifications(): void
    {
        $n = $this->makeNotification($this->user, ['is_read' => false]);

        $this->actingAs($this->user)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()->assertJsonPath('data.unread_count', 1);

        // Archiving makes it unreachable in every list the user can open, so it
        // must also leave the badge — otherwise a phantom unread that can never
        // be cleared by tapping.
        $this->actingAs($this->user)->putJson("/api/v1/notifications/{$n->id}/archive")->assertOk();

        $this->actingAs($this->user)->getJson('/api/v1/notifications/unread-count')
            ->assertOk()->assertJsonPath('data.unread_count', 0);
    }

    public function test_clear_all_empties_users_notifications(): void
    {
        $this->makeNotification($this->user);
        $this->makeNotification($this->user);
        $this->makeNotification($this->user);

        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $othersNotification = $this->makeNotification($other);

        $this->actingAs($this->user)
            ->deleteJson('/api/v1/notifications')
            ->assertOk()
            ->assertJsonPath('data.deleted_count', 3);

        $this->assertSame(0, Notification::where('user_id', $this->user->id)->count());
        // Other users' notifications are untouched.
        $this->assertDatabaseHas('notifications', ['id' => $othersNotification->id]);
    }
}
