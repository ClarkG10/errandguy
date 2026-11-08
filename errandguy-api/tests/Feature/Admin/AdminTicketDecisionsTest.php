<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\SupportTickets\Pages\ViewSupportTicket;
use App\Filament\Resources\SupportTickets\RelationManagers\MessagesRelationManager;
use App\Jobs\SendPushJob;
use App\Models\AdminUser;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * The support queue gates a waiting human, so its decision must sit WHERE the
 * conversation is, and carry the facts the decision needs.
 *
 * Covers:
 *  - the support record page mounting the same status decision as the list row;
 *  - the "Waiting on us" queue: a customer reply leaves the ticket 'pending', so
 *    status alone cannot say who is being waited on;
 *  - the thread naming the agent who replied.
 */
class AdminTicketDecisionsTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $role = 'super_admin', string $name = 'Super Admin'): AdminUser
    {
        return AdminUser::forceCreate([
            'email' => $role.'-'.uniqid().'@errandguy.test',
            'password_hash' => Hash::make('Password1!'),
            'full_name' => $name, 'role' => $role, 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
    }

    private function ticket(User $user, string $subject, string $status): SupportTicket
    {
        return SupportTicket::create([
            'user_id' => $user->id, 'subject' => $subject, 'category' => 'booking',
            'status' => $status, 'last_message_at' => now()->subHour(),
        ]);
    }

    /**
     * support_messages.created_at is a DB default with SECOND precision, so two
     * messages written in the same test tick would tie and make "who spoke last"
     * ambiguous. Pin the timestamps explicitly.
     */
    private function message(SupportTicket $ticket, string $type, ?string $senderId, string $body, $at): SupportMessage
    {
        $message = new SupportMessage([
            'ticket_id' => $ticket->id, 'sender_id' => $senderId,
            'sender_type' => $type, 'content' => $body,
        ]);
        $message->forceFill(['created_at' => $at])->save();

        return $message;
    }

    public function test_a_customer_reply_on_a_pending_ticket_lands_in_the_waiting_on_us_queue(): void
    {
        $this->actingAs($this->admin(), 'admin');
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        // Agent spoke last → genuinely waiting on the USER.
        $waitingOnUser = $this->ticket($user, 'Ticket AwaitingTheuser', 'pending');
        $this->message($waitingOnUser, 'user', $user->id, 'My errand never arrived', now()->subHours(3));
        $this->agentMessage($waitingOnUser, 'Could you confirm the address?', now()->subHours(2));

        // Customer answered → waiting on US, but the status is still 'pending'.
        $waitingOnUs = $this->ticket($user, 'Ticket AwaitingOurreply', 'pending');
        $this->message($waitingOnUs, 'user', $user->id, 'First question', now()->subHours(5));
        $this->agentMessage($waitingOnUs, 'Looking into it', now()->subHours(4));
        $this->message($waitingOnUs, 'user', $user->id, 'Any update?', now()->subHours(1));

        $this->assertSame(1, SupportTicket::needsReply()->count());
        $this->assertTrue(SupportTicket::needsReply()->whereKey($waitingOnUs->id)->exists());

        $html = $this->get('/admin/support-tickets?tab=awaiting')->assertOk()->getContent();
        $this->assertStringContainsString('AwaitingOurreply', $html);
        $this->assertStringNotContainsString('AwaitingTheuser', $html);
    }

    public function test_the_waiting_on_us_queue_is_oldest_unanswered_first(): void
    {
        $this->actingAs($this->admin(), 'admin');
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);

        $newest = $this->ticket($user, 'Ticket Justcamein', 'open');
        $newest->forceFill(['last_message_at' => now()->subMinutes(5)])->save();
        $this->message($newest, 'user', $user->id, 'Hello', now()->subMinutes(5));

        $oldest = $this->ticket($user, 'Ticket Waitingthreedays', 'open');
        $oldest->forceFill(['last_message_at' => now()->subDays(3)])->save();
        $this->message($oldest, 'user', $user->id, 'Hello', now()->subDays(3));

        $html = $this->get('/admin/support-tickets?tab=awaiting')->assertOk()->getContent();

        $this->assertLessThan(
            strpos($html, 'Justcamein'),
            strpos($html, 'Waitingthreedays'),
            'the user waiting longest for an answer must be at the top',
        );
    }

    public function test_the_support_thread_names_the_agent_who_replied(): void
    {
        $agent = $this->admin('support', 'Carlos Agent');
        // A DIFFERENT admin reads the thread, so 'Carlos Agent' can only come
        // from the message row — not from the panel's own topbar user menu.
        $this->actingAs($this->admin('admin', 'Desk Admin'), 'admin');
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active', 'full_name' => 'Ana Customer']);

        $ticket = $this->ticket($user, 'Where is my errand', 'pending');
        $fromUser = $this->message($ticket, 'user', $user->id, 'Still waiting', now()->subHours(2));
        $this->agentMessage($ticket, 'On it, sorry for the delay', now()->subHour(), $agent->id);
        $fromAgent = SupportMessage::where('ticket_id', $ticket->id)->where('sender_type', 'agent')->firstOrFail();

        // The thread is a (lazy) relation manager, so drive it directly.
        Livewire::test(MessagesRelationManager::class, [
            'ownerRecord' => $ticket,
            'pageClass' => ViewSupportTicket::class,
        ])
            ->assertTableColumnFormattedStateSet('sender_type', 'Carlos Agent', $fromAgent)
            ->assertTableColumnFormattedStateSet('sender_type', 'Ana Customer', $fromUser);
    }

    public function test_the_support_record_page_carries_the_status_decision(): void
    {
        $this->actingAs($this->admin(), 'admin');
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $ticket = $this->ticket($user, 'Refund question', 'open');

        Livewire::test(ViewSupportTicket::class, ['record' => $ticket->id])
            ->assertActionVisible('setStatus');
    }

    /**
     * A staff member answers from the panel and the customer can read it. This
     * failed on every reply until 2026-11-08: support_messages.sender_id had a
     * foreign key to users, while a staff reply stores an admin_users id.
     */
    public function test_staff_can_reply_and_the_customer_reads_it_as_support(): void
    {
        Queue::fake();
        $agent = $this->admin('support', 'Carlos Agent');
        $this->actingAs($agent, 'admin');
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $ticket = $this->ticket($user, 'Where is my refund', 'open');
        $this->message($ticket, 'user', $user->id, 'Hello?', now()->subHour());

        Livewire::test(MessagesRelationManager::class, [
            'ownerRecord' => $ticket,
            'pageClass' => ViewSupportTicket::class,
        ])
            ->callTableAction('reply', data: ['content' => 'Your refund went out today.'])
            ->assertHasNoTableActionErrors();

        $reply = SupportMessage::where('ticket_id', $ticket->id)->where('sender_type', 'agent')->firstOrFail();
        $this->assertSame($agent->id, $reply->sender_id);
        $this->assertFalse(User::whereKey($agent->id)->exists(), 'no shadow users row was needed');
        $this->assertSame('pending', $ticket->fresh()->status);
        Queue::assertPushed(SendPushJob::class);

        // The customer's thread shows the reply, from "Support" — never a
        // customer's name.
        $messages = $this->actingAs($user, 'sanctum')
            ->getJson("/api/v1/support/tickets/{$ticket->id}")
            ->assertOk()
            ->json('data.messages');
        $fromStaff = collect($messages)->firstWhere('sender_type', 'agent');
        $this->assertSame('Your refund went out today.', $fromStaff['content']);
        $this->assertNull($fromStaff['sender'] ?? null);
    }

    /** Seeds an AGENT reply: sender_id holds the staff member's admin_users id. */
    private function agentMessage(SupportTicket $ticket, string $body, $at, ?string $adminId = null): void
    {
        $adminId ??= $this->admin('support', 'Some Agent')->id;

        $this->message($ticket, 'agent', $adminId, $body, $at);
    }
}
