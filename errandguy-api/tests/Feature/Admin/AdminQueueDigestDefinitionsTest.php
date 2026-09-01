<?php

namespace Tests\Feature\Admin;

use App\Mail\AdminQueueDigest;
use App\Models\RunnerProfile;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\SystemConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The digest email exists to pull an admin INTO the panel — so its counts must
 * be computed from the same definitions as the panel cards it points at. When
 * the panel moved to ready-for-review KYC and needs-reply support, the digest
 * kept the old bare-status queries: an email saying "37 waiting" against a
 * panel showing 4 ready teaches admins the email lies.
 */
class AdminQueueDigestDefinitionsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        SystemConfig::setValue('admin_alert_email', 'ops@errandguy.test');
    }

    private function makeRunnerProfile(bool $ready): RunnerProfile
    {
        $user = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $profile = RunnerProfile::create([
            'user_id' => $user->id, 'verification_status' => 'pending',
            'is_online' => false, 'preferred_types' => [],
        ]);
        $profile->forceFill(['created_at' => now()->subDays(3)])->save();

        if ($ready) {
            // runner_documents.runner_id references runner_profiles.id.
            foreach (RunnerProfile::REQUIRED_DOCUMENT_TYPES as $type) {
                \App\Models\RunnerDocument::create([
                    'runner_id' => $profile->id,
                    'document_type' => $type,
                    'file_url' => 'kyc/x.jpg',
                    'status' => 'pending',
                ]);
            }
        }

        return $profile;
    }

    public function test_kyc_count_matches_the_panels_ready_for_review_definition(): void
    {
        Mail::fake();

        // One application with every required doc, one that never uploaded
        // anything — the old bare-pending query counted both.
        $this->makeRunnerProfile(ready: true);
        $this->makeRunnerProfile(ready: false);

        $this->artisan('errandguy:admin-queue-alert')->assertSuccessful();

        Mail::assertSent(AdminQueueDigest::class, function (AdminQueueDigest $mail) {
            $kyc = collect($mail->queues)->firstWhere('key', 'kyc');

            return $kyc !== null && $kyc['count'] === 1;
        });
    }

    public function test_support_count_matches_the_panels_needs_reply_definition(): void
    {
        Mail::fake();

        $customer = User::factory()->create(['role' => 'customer']);

        // Never answered: counted by both old and new definitions.
        $open = SupportTicket::create([
            'user_id' => $customer->id, 'subject' => 'A', 'category' => 'other',
            'status' => 'open',
        ]);
        $open->forceFill([
            'created_at' => now()->subDays(2),
            'last_message_at' => now()->subDays(2),
        ])->save();

        // Answered once, then the CUSTOMER replied — the ball is back with us,
        // but the old status='open' query missed it entirely.
        $replied = SupportTicket::create([
            'user_id' => $customer->id, 'subject' => 'B', 'category' => 'other',
            'status' => 'pending',
        ]);
        SupportMessage::create([
            'ticket_id' => $replied->id, 'sender_type' => 'agent', 'sender_id' => null,
            'content' => 'Hello, how can we help?',
        ]);
        SupportMessage::create([
            'ticket_id' => $replied->id, 'sender_type' => 'user', 'sender_id' => $customer->id,
            'content' => 'Still broken.',
        ]);
        $replied->forceFill([
            'created_at' => now()->subDays(2),
            'last_message_at' => now()->subDays(1),
        ])->save();

        $this->artisan('errandguy:admin-queue-alert')->assertSuccessful();

        Mail::assertSent(AdminQueueDigest::class, function (AdminQueueDigest $mail) {
            $support = collect($mail->queues)->firstWhere('key', 'support');

            return $support !== null && $support['count'] === 2;
        });
    }
}
