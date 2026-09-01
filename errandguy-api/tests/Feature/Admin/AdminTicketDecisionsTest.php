<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\DisputeTickets\Actions\DisputeTicketActions;
use App\Filament\Resources\DisputeTickets\DisputeTicketResource;
use App\Filament\Resources\DisputeTickets\Pages\ViewDisputeTicket;
use App\Filament\Resources\SupportTickets\Pages\ViewSupportTicket;
use App\Filament\Resources\SupportTickets\RelationManagers\MessagesRelationManager;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\DisputeTicket;
use App\Models\ErrandType;
use App\Models\Payment;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * The two admin queues that gate a waiting human — disputes and support — must
 * carry their decision WHERE the evidence is, and carry the facts the decision
 * needs.
 *
 * Covers:
 *  - the dispute/support record pages mounting the same decisions as the list
 *    row (previously the admin read the evidence, navigated BACK, re-found the
 *    row, and only then clicked Resolve);
 *  - "Resolve + refund" disabled with a readable reason when the booking has no
 *    completed online payment, instead of failing AFTER the resolution note has
 *    been typed and discarding it;
 *  - refundability resolved by ONE exists-subselect for the whole page, and
 *    failing SAFE (action shown) when the flag is absent;
 *  - the support "Waiting on us" queue: a customer reply leaves the ticket
 *    'pending', so status alone cannot say who is being waited on;
 *  - resolved_by rendered as a name rather than a raw admin UUID, and the dead
 *    'reviewing' status finally having a writer.
 */
class AdminTicketDecisionsTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $role = 'super_admin', string $name = 'Super Admin'): AdminUser
    {
        return AdminUser::create([
            'email' => $role.'-'.uniqid().'@errandguy.test',
            'password_hash' => Hash::make('Password1!'),
            'full_name' => $name, 'role' => $role, 'is_active' => true,
        ]);
    }

    private function booking(string $suffix): Booking
    {
        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::firstOrCreate(['slug' => 'delivery'], [
            'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);

        return Booking::create([
            'booking_number' => 'EG-DEC-'.$suffix,
            'customer_id' => $customer->id, 'errand_type_id' => $type->id, 'status' => 'completed',
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false,
        ]);
    }

    private function dispute(Booking $booking, array $extra = []): DisputeTicket
    {
        return DisputeTicket::create(array_merge([
            'booking_id' => $booking->id,
            'reported_by' => $booking->customer_id,
            'category' => 'item_damaged',
            'description' => 'The item arrived broken.',
            'status' => 'open',
        ], $extra));
    }

    private function payment(Booking $booking, string $method, string $status = 'completed'): Payment
    {
        return Payment::create([
            'booking_id' => $booking->id,
            'customer_id' => $booking->customer_id,
            'amount' => 115, 'currency' => 'PHP',
            'method' => $method, 'status' => $status,
            'paid_at' => $status === 'completed' ? now() : null,
        ]);
    }

    /** The record, hydrated exactly as the panel hydrates it (withExists flag included). */
    private function panelRecord(DisputeTicket $dispute): DisputeTicket
    {
        return DisputeTicketResource::getEloquentQuery()->whereKey($dispute->id)->firstOrFail();
    }

    // ---------------------------------------------------------------- disputes

    public function test_the_dispute_record_page_carries_the_decisions_that_used_to_live_only_on_the_list_row(): void
    {
        $this->actingAs($this->admin(), 'admin');
        $dispute = $this->dispute($this->booking('HDR'));

        Livewire::test(ViewDisputeTicket::class, ['record' => $dispute->id])
            ->assertActionVisible('resolve')
            ->assertActionVisible('resolveRefund')
            ->assertActionVisible('escalate')
            ->assertActionVisible('startReviewing');
    }

    public function test_resolve_refund_is_disabled_with_a_reason_when_the_booking_was_cash(): void
    {
        $this->actingAs($this->admin(), 'admin');
        $booking = $this->booking('CASH');
        $this->payment($booking, 'cash');
        $dispute = $this->dispute($booking);

        // Cash is settled runner-to-customer; PaymentService::refundToWallet
        // throws on it, so the button must say so BEFORE the note is typed.
        Livewire::test(ViewDisputeTicket::class, ['record' => $dispute->id])
            ->assertActionVisible('resolveRefund')
            ->assertActionDisabled('resolveRefund');

        $this->assertTrue(DisputeTicketActions::refundBlocked($this->panelRecord($dispute)));
    }

    public function test_resolve_refund_stays_live_when_a_completed_online_payment_exists(): void
    {
        $this->actingAs($this->admin(), 'admin');
        $booking = $this->booking('GCASH');
        $this->payment($booking, 'gcash');
        $dispute = $this->dispute($booking);

        Livewire::test(ViewDisputeTicket::class, ['record' => $dispute->id])
            ->assertActionEnabled('resolveRefund');

        $this->assertFalse(DisputeTicketActions::refundBlocked($this->panelRecord($dispute)));
    }

    public function test_an_unknown_refundability_flag_fails_safe_and_leaves_the_action_available(): void
    {
        // A record hydrated by some other query carries no is_refundable
        // attribute. Hiding a legitimate refund is worse than offering one that
        // PaymentService will reject, so "unknown" must NOT block.
        $bare = new DisputeTicket(['status' => 'open']);
        $this->assertFalse(DisputeTicketActions::refundBlocked($bare));
        $this->assertFalse(DisputeTicketActions::refundBlocked(null));

        $bare->setAttribute('is_refundable', 0);
        $this->assertTrue(DisputeTicketActions::refundBlocked($bare));

        $bare->setAttribute('is_refundable', 1);
        $this->assertFalse(DisputeTicketActions::refundBlocked($bare));
    }

    public function test_refundability_and_payment_facts_cost_no_per_row_query(): void
    {
        $this->actingAs($this->admin(), 'admin');

        foreach (['N1', 'N2', 'N3'] as $i => $suffix) {
            $booking = $this->booking($suffix);
            $this->payment($booking, $i === 0 ? 'cash' : 'gcash');
            $this->dispute($booking);
        }

        $paymentQueries = 0;
        DB::listen(function ($query) use (&$paymentQueries): void {
            if (str_contains($query->sql, 'payments')) {
                $paymentQueries++;
            }
        });

        $this->get('/admin/dispute-tickets')->assertOk();

        // One statement carries the exists() subselect, one eager-loads the
        // payment rows. Three disputes must not mean three lookups.
        $this->assertLessThanOrEqual(
            2,
            $paymentQueries,
            'refundability must be resolved on the eager load, not per row',
        );
    }

    public function test_the_dispute_list_shows_the_amount_and_how_it_was_paid(): void
    {
        $this->actingAs($this->admin(), 'admin');
        $booking = $this->booking('FACTS');
        $this->payment($booking, 'gcash');
        $this->dispute($booking);

        $this->get('/admin/dispute-tickets')
            ->assertOk()
            ->assertSee('Refundable')
            ->assertSee('Paid via')
            ->assertSee('GCASH');
    }

    public function test_the_booking_number_links_to_the_booking_record(): void
    {
        $this->actingAs($this->admin(), 'admin');
        $booking = $this->booking('LINK');
        $dispute = $this->dispute($booking);

        $this->get("/admin/dispute-tickets/{$dispute->id}/view")
            ->assertOk()
            ->assertSee('/admin/bookings/'.$booking->id.'/view', escape: false);
    }

    public function test_resolved_by_renders_the_admin_name_instead_of_a_raw_uuid(): void
    {
        $resolver = $this->admin('support', 'Maria Resolver');
        $this->actingAs($this->admin(), 'admin');

        $dispute = $this->dispute($this->booking('RSLV'), [
            'status' => 'resolved',
            'resolution' => 'Refunded in full.',
            'resolved_by' => $resolver->id,
            'resolved_at' => now(),
        ]);

        $this->get("/admin/dispute-tickets/{$dispute->id}/view")
            ->assertOk()
            ->assertSee('Maria Resolver')
            ->assertDontSee($resolver->id);
    }

    public function test_start_reviewing_claims_the_dispute_and_names_the_claimant(): void
    {
        $claimant = $this->admin('support', 'Nina Claimant');
        $this->actingAs($claimant, 'admin');
        $dispute = $this->dispute($this->booking('CLAIM'));

        Livewire::test(ViewDisputeTicket::class, ['record' => $dispute->id])
            ->callAction('startReviewing');

        // The 'reviewing' tab, badge and filter existed with no writer at all.
        $this->assertSame('reviewing', $dispute->fresh()->status);

        // A COLLEAGUE opens it next — the whole point of claiming — so the name
        // on the page is the claimant's, not the viewer's own topbar name.
        $this->actingAs($this->admin('admin', 'Other Admin'), 'admin');

        $this->get("/admin/dispute-tickets/{$dispute->id}/view")
            ->assertOk()
            ->assertSee('Being reviewed by')
            ->assertSee('Nina Claimant');
    }

    // ---------------------------------------------------------------- support

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
     * Seeds an AGENT reply.
     *
     * The shadow users row is NOT decoration: support_messages.sender_id carries
     * a foreign key to users(id) while an agent reply stores an admin_users id
     * (MessagesRelationManager), so today a real agent reply cannot be inserted
     * at all — a schema bug reported alongside this work, whose fix is a
     * migration and therefore out of scope here. Writing a users row under the
     * same uuid is the only way to seed the row the panel intends to write; it
     * stays harmless once the constraint is corrected.
     */
    private function agentMessage(SupportTicket $ticket, string $body, $at, ?string $adminId = null): void
    {
        $adminId ??= $this->admin('support', 'Some Agent')->id;

        if (! User::whereKey($adminId)->exists()) {
            User::factory()->create(['id' => $adminId, 'role' => 'customer', 'status' => 'active']);
        }

        $this->message($ticket, 'agent', $adminId, $body, $at);
    }
}
