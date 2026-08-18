<?php

namespace Tests\Feature\Support;

use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SupportTicketTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
    }

    public function test_user_can_open_a_ticket(): void
    {
        $response = $this->actingAs($this->user)->postJson('/api/v1/support/tickets', [
            'subject' => 'Missing item from order',
            'category' => 'booking_issue',
            'message' => 'My delivery arrived without one of the items.',
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.subject', 'Missing item from order')
            ->assertJsonPath('data.category', 'booking_issue')
            ->assertJsonPath('data.status', 'open');

        $ticketId = $response->json('data.id');

        $this->assertDatabaseHas('support_tickets', [
            'id' => $ticketId,
            'user_id' => $this->user->id,
            'status' => 'open',
        ]);
        $this->assertDatabaseHas('support_messages', [
            'ticket_id' => $ticketId,
            'sender_id' => $this->user->id,
            'sender_type' => 'user',
            'content' => 'My delivery arrived without one of the items.',
        ]);
        $this->assertNotNull(SupportTicket::find($ticketId)->last_message_at);
    }

    public function test_ticket_list_includes_latest_message_preview(): void
    {
        $this->actingAs($this->user)->postJson('/api/v1/support/tickets', [
            'subject' => 'Refund question',
            'category' => 'general',
            'message' => 'the first and latest message',
        ])->assertCreated();

        // The list row's preview + unread indicator read latest_message; it must
        // be present (previously omitted because the relation was never loaded).
        $this->actingAs($this->user)->getJson('/api/v1/support/tickets')
            ->assertOk()
            ->assertJsonPath('data.0.latest_message.content', 'the first and latest message');
    }

    public function test_open_ticket_requires_subject_and_message(): void
    {
        $this->actingAs($this->user)
            ->postJson('/api/v1/support/tickets', ['category' => 'general'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['subject', 'message']);
    }

    public function test_user_can_post_a_message_to_own_ticket(): void
    {
        $ticket = SupportTicket::create([
            'user_id' => $this->user->id,
            'subject' => 'Help',
            'category' => 'general',
            'status' => 'open',
        ]);

        $response = $this->actingAs($this->user)->postJson(
            "/api/v1/support/tickets/{$ticket->id}/messages",
            ['content' => 'Any update on this?']
        );

        $response->assertCreated()
            ->assertJsonPath('data.sender_type', 'user')
            ->assertJsonPath('data.content', 'Any update on this?');

        $this->assertDatabaseHas('support_messages', [
            'ticket_id' => $ticket->id,
            'content' => 'Any update on this?',
        ]);
        $this->assertNotNull($ticket->fresh()->last_message_at);
    }

    public function test_posting_message_reopens_resolved_ticket(): void
    {
        $ticket = SupportTicket::create([
            'user_id' => $this->user->id,
            'subject' => 'Help',
            'category' => 'general',
            'status' => 'resolved',
        ]);

        $this->actingAs($this->user)
            ->postJson("/api/v1/support/tickets/{$ticket->id}/messages", ['content' => 'Reopening'])
            ->assertCreated();

        $this->assertSame('pending', $ticket->fresh()->status);
    }

    public function test_user_can_view_own_ticket_with_messages(): void
    {
        $ticket = SupportTicket::create([
            'user_id' => $this->user->id,
            'subject' => 'Help',
            'category' => 'general',
            'status' => 'open',
        ]);
        SupportMessage::create([
            'ticket_id' => $ticket->id,
            'sender_id' => $this->user->id,
            'sender_type' => 'user',
            'content' => 'First message',
        ]);

        $this->actingAs($this->user)
            ->getJson("/api/v1/support/tickets/{$ticket->id}")
            ->assertOk()
            ->assertJsonPath('data.ticket.id', $ticket->id)
            ->assertJsonPath('data.messages.0.content', 'First message')
            ->assertJsonPath('meta.has_more', false);
    }

    public function test_index_lists_only_own_tickets(): void
    {
        SupportTicket::create([
            'user_id' => $this->user->id,
            'subject' => 'Mine', 'category' => 'general', 'status' => 'open',
        ]);
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        SupportTicket::create([
            'user_id' => $other->id,
            'subject' => 'Theirs', 'category' => 'general', 'status' => 'open',
        ]);

        $response = $this->actingAs($this->user)->getJson('/api/v1/support/tickets')->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertSame('Mine', $response->json('data.0.subject'));
    }

    public function test_user_cannot_view_others_ticket(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $ticket = SupportTicket::create([
            'user_id' => $other->id,
            'subject' => 'Private', 'category' => 'general', 'status' => 'open',
        ]);

        $this->actingAs($this->user)
            ->getJson("/api/v1/support/tickets/{$ticket->id}")
            ->assertForbidden();
    }

    public function test_user_cannot_post_to_others_ticket(): void
    {
        $other = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $ticket = SupportTicket::create([
            'user_id' => $other->id,
            'subject' => 'Private', 'category' => 'general', 'status' => 'open',
        ]);

        $this->actingAs($this->user)
            ->postJson("/api/v1/support/tickets/{$ticket->id}/messages", ['content' => 'intruding'])
            ->assertForbidden();
    }
}
