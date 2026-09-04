<?php

namespace Tests\Feature\Admin;

use App\Filament\Widgets\ActionQueue;
use App\Models\AdminUser;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * Support belongs on the dashboard.
 *
 * SOS, stuck errands, KYC, disputes and payouts all had a card in the action
 * queue. Support did not — so a customer waiting on a first reply was invisible
 * from the one screen an operator actually opens, and the only way to notice
 * was to remember to visit the tickets list. The "Waiting on us" tab already
 * existed with the right scope and oldest-first ordering; nothing surfaced it.
 *
 * The card counts SupportTicket::needsReply() and links to that exact tab, so
 * the number on the card always matches the list it opens.
 */
class SupportQueueCardTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->actingAs(AdminUser::create([
            'email' => 'ops@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Ops', 'role' => 'super_admin', 'is_active' => true,
        ]), 'admin');
    }

    /**
     * A ticket "needs reply" when the LAST message came from the user. The
     * status column cannot answer this — an agent reply sets 'pending' and the
     * customer's answer leaves it there.
     */
    private function ticket(string $lastSender, int $minutesAgo = 30): SupportTicket
    {
        $user = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $ticket = SupportTicket::create([
            'user_id' => $user->id,
            'subject' => 'Where is my errand',
            // `category` is NOT NULL; `priority` is not a column on this table.
            'category' => 'booking',
            'status' => 'pending',
            // last_message_at IS fillable here, unlike created_at elsewhere —
            // it is what the card ages on (when the USER last spoke).
            'last_message_at' => now()->subMinutes($minutesAgo),
        ]);
        SupportMessage::create([
            'ticket_id' => $ticket->id,
            'sender_id' => $user->id,
            'sender_type' => $lastSender,
            'content' => 'hello',
        ]);

        return $ticket->refresh();
    }

    /**
     * The widget's cards. getStats() is protected on StatsOverviewWidget, so
     * it is reached by reflection — truer than matching numbers in rendered
     * HTML, where a count like "2" appears in half a dozen unrelated places.
     *
     * @return list<\Filament\Widgets\StatsOverviewWidget\Stat>
     */
    private function cards(): array
    {
        $widget = Livewire::test(ActionQueue::class)->instance();
        $method = new \ReflectionMethod($widget, 'getStats');
        $method->setAccessible(true);

        return $method->invoke($widget);
    }

    /** @return array<string,string> label => value */
    private function cardValues(): array
    {
        $out = [];
        foreach ($this->cards() as $stat) {
            $out[$stat->getLabel()] = $stat->getValue();
        }

        return $out;
    }

    public function test_the_dashboard_has_a_support_card(): void
    {
        $this->assertArrayHasKey('Waiting on us', $this->cardValues());
    }

    public function test_it_counts_only_tickets_where_the_user_spoke_last(): void
    {
        $this->ticket('user');
        $this->ticket('user');
        // Already answered — an agent spoke last, so nobody is waiting on us.
        $this->ticket('agent');

        $this->assertSame('2', $this->cardValues()['Waiting on us']);
    }

    public function test_it_reads_zero_when_everyone_has_been_answered(): void
    {
        $this->ticket('agent');

        $this->assertSame('0', $this->cardValues()['Waiting on us']);
    }

    /**
     * The card must open the list it counted. Landing on the All tab — where
     * the longest-unanswered customer is last — is what made the existing
     * badge useless.
     */
    public function test_it_links_to_the_awaiting_tab_not_the_full_list(): void
    {
        $this->ticket('user');

        $card = collect($this->cards())->first(fn ($s) => $s->getLabel() === 'Waiting on us');

        $this->assertNotNull($card);
        $this->assertStringContainsString('awaiting', (string) $card->getUrl());
    }
}
