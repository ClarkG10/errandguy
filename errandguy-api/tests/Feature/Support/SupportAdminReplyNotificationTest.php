<?php

namespace Tests\Feature\Support;

use App\Filament\Resources\SupportTickets\SupportTicketNotifier;
use App\Models\Notification;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * An agent reply / status change used to be COMPLETELY silent: the row was
 * inserted and the user, sitting in the thread, had no way to learn about it
 * short of backing out and re-opening the screen.
 *
 * These lock the delivery contract the mobile thread refresh keys on:
 *   reply         → data { type: 'support_reply',  ticket_id }
 *   status change → data { type: 'support_status', ticket_id, status }
 * plus the idempotency latches and the "no ticket content in the copy" rule.
 *
 * QUEUE_CONNECTION=sync in phpunit.xml, so SendPushJob runs inline and the
 * in-app notification row is observable here.
 */
class SupportAdminReplyNotificationTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private SupportTicket $ticket;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->ticket = SupportTicket::create([
            'user_id' => $this->user->id,
            'subject' => 'Where is my parcel',
            'category' => 'booking_issue',
            'status' => 'open',
            'last_message_at' => now(),
        ]);
    }

    private function agentReply(string $content = 'We are checking with the runner now.'): SupportMessage
    {
        return SupportMessage::create([
            'ticket_id' => $this->ticket->id,
            'sender_id' => $this->user->id, // stand-in; sender identity is irrelevant here
            'sender_type' => 'agent',
            'content' => $content,
        ]);
    }

    private function notifications(): \Illuminate\Database\Eloquent\Collection
    {
        return Notification::where('user_id', $this->user->id)->get();
    }

    public function test_agent_reply_notifies_the_owner_with_the_support_reply_payload(): void
    {
        SupportTicketNotifier::replied($this->ticket, $this->agentReply());

        $rows = $this->notifications();
        $this->assertCount(1, $rows);

        $notification = $rows->first();
        $this->assertSame('support_reply', $notification->type);
        $this->assertSame('support_reply', $notification->data['type']);
        $this->assertSame($this->ticket->id, $notification->data['ticket_id']);
    }

    public function test_reply_copy_leaks_neither_the_reply_text_nor_the_ticket_subject(): void
    {
        SupportTicketNotifier::replied($this->ticket, $this->agentReply('Your refund of PHP 450 was approved.'));

        $notification = $this->notifications()->first();
        $haystack = strtolower($notification->title.' '.$notification->body);

        $this->assertStringNotContainsString('refund of php 450', $haystack);
        $this->assertStringNotContainsString('parcel', $haystack, 'the user-authored subject must not reach a push payload');
    }

    public function test_the_same_reply_notifies_only_once(): void
    {
        $message = $this->agentReply();

        SupportTicketNotifier::replied($this->ticket, $message);
        SupportTicketNotifier::replied($this->ticket, $message);

        $this->assertCount(1, $this->notifications(), 'a retried reply action must not double-notify');
    }

    public function test_two_distinct_replies_each_notify(): void
    {
        SupportTicketNotifier::replied($this->ticket, $this->agentReply('first'));
        SupportTicketNotifier::replied($this->ticket, $this->agentReply('second'));

        $this->assertCount(2, $this->notifications());
    }

    public function test_status_change_notifies_with_the_support_status_payload(): void
    {
        SupportTicketNotifier::statusChanged($this->ticket, 'resolved');

        $notification = $this->notifications()->first();
        $this->assertNotNull($notification);
        $this->assertSame('support_status', $notification->type);
        $this->assertSame('support_status', $notification->data['type']);
        $this->assertSame($this->ticket->id, $notification->data['ticket_id']);
        $this->assertSame('resolved', $notification->data['status']);
    }

    public function test_closed_and_reopened_statuses_also_notify(): void
    {
        SupportTicketNotifier::statusChanged($this->ticket, 'closed');
        SupportTicketNotifier::statusChanged($this->ticket, 'open');

        $this->assertEqualsCanonicalizing(
            ['closed', 'open'],
            $this->notifications()->pluck('data')->pluck('status')->all(),
        );
    }

    public function test_pending_status_does_not_notify_because_every_reply_sets_it(): void
    {
        SupportTicketNotifier::statusChanged($this->ticket, 'pending');

        $this->assertCount(0, $this->notifications());
    }

    public function test_repeating_the_same_status_inside_the_latch_notifies_once(): void
    {
        SupportTicketNotifier::statusChanged($this->ticket, 'resolved');
        SupportTicketNotifier::statusChanged($this->ticket, 'resolved');

        $this->assertCount(1, $this->notifications());
    }

    public function test_nothing_is_sent_for_a_ticket_with_no_owner(): void
    {
        // Defensive: a ticket row whose user was hard-deleted must not blow up
        // the admin's reply action.
        $orphan = new SupportTicket(['subject' => 'x', 'category' => 'general', 'status' => 'open']);
        $orphan->id = (string) \Illuminate\Support\Str::uuid();
        $orphan->user_id = null;

        SupportTicketNotifier::statusChanged($orphan, 'resolved');

        $this->assertSame(0, Notification::count());
    }
}
