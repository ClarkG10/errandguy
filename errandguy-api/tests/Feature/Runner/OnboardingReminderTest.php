<?php

namespace Tests\Feature\Runner;

use App\Models\Notification;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Nudging runners who started signing up and stopped.
 *
 * A runner registers, lands on the document gate, and has to go find a
 * government ID and take a selfie — so many of them put the phone down
 * intending to come back. Nothing ever reminded them: the application sat at
 * `pending` with a missing document forever, the runner never earned a peso,
 * and the platform never got the supply, all over a task that was genuinely
 * just forgotten.
 *
 * Half of these tests are about the delivery. The other half are about
 * RESTRAINT, which is the part that makes a reminder feature acceptable rather
 * than a reason to uninstall: never nudge someone waiting on US, never nudge
 * someone who never applied, stop after three, and stop entirely once the
 * application is cold.
 */
class OnboardingReminderTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);
    }

    /**
     * @param  list<string>  $docs  document types already on file (accepted)
     * @param  list<string>  $rejectedDocs  document types on file but rejected
     */
    private function applicant(
        array $docs = [],
        int $ageHours = 48,
        string $role = 'runner',
        array $rejectedDocs = [],
    ): RunnerProfile {
        $user = User::factory()->create(['role' => $role, 'status' => 'active']);
        $profile = RunnerProfile::create([
            'user_id' => $user->id,
            'verification_status' => 'pending',
        ]);
        // created_at is not fillable, and the age filters are the whole point.
        $profile->forceFill(['created_at' => now()->subHours($ageHours)])->save();

        foreach ($docs as $type) {
            RunnerDocument::create([
                // FK is runner_documents.runner_id -> runner_profiles.id.
                'runner_id' => $profile->id,
                'document_type' => $type,
                'file_url' => 'kyc/'.$type.'.jpg',
                'status' => 'pending',
            ]);
        }
        foreach ($rejectedDocs as $type) {
            RunnerDocument::create([
                'runner_id' => $profile->id,
                'document_type' => $type,
                'file_url' => 'kyc/'.$type.'.jpg',
                'status' => 'rejected',
            ]);
        }

        return $profile->refresh();
    }

    private function remindersFor(RunnerProfile $profile)
    {
        return Notification::where('user_id', $profile->user_id)
            ->where('type', 'onboarding_reminder')
            ->get();
    }

    public function test_an_unfinished_application_is_nudged_and_told_what_is_missing(): void
    {
        // Selfie on file, government ID never uploaded.
        $profile = $this->applicant(['selfie']);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $reminders = $this->remindersFor($profile);
        $this->assertCount(1, $reminders);
        // Naming the missing thing is the point: "finish your application" is a
        // chore, "add a government ID" is a two-minute task.
        $this->assertStringContainsString('government ID', $reminders->first()->body);
        $this->assertStringNotContainsString('selfie', $reminders->first()->body);
    }

    public function test_it_names_both_documents_when_nothing_was_uploaded(): void
    {
        $profile = $this->applicant([]);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $body = $this->remindersFor($profile)->first()->body;
        $this->assertStringContainsString('government ID', $body);
        $this->assertStringContainsString('selfie', $body);
    }

    /**
     * The single most important exclusion. This runner has submitted everything
     * and is waiting on an admin — pushing them to "finish signing up" blames
     * them for our review queue.
     */
    public function test_a_complete_application_awaiting_review_is_never_nudged(): void
    {
        $profile = $this->applicant(['selfie', 'government_id']);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $this->assertCount(0, $this->remindersFor($profile));
    }

    /**
     * A profile row is lazily created just by a customer toggling to the runner
     * tab and looking around. They never started an application and must not be
     * pushed about documents they never began.
     */
    public function test_someone_who_only_browsed_the_runner_tab_is_not_nudged(): void
    {
        $profile = $this->applicant([], 48, 'customer');

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $this->assertCount(0, $this->remindersFor($profile));
    }

    public function test_a_brand_new_application_gets_a_chance_to_finish_unprompted(): void
    {
        $profile = $this->applicant([], 2);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $this->assertCount(0, $this->remindersFor($profile));
    }

    public function test_a_cold_application_is_left_alone(): void
    {
        // Past the fortnight — not forgotten, just not happening.
        $profile = $this->applicant([], 24 * 30);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $this->assertCount(0, $this->remindersFor($profile));
    }

    /**
     * The scheduler runs daily. Without a gap, an unfinished application would
     * be nudged every single morning.
     */
    public function test_it_does_not_nudge_again_the_next_day(): void
    {
        $profile = $this->applicant([]);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();
        $this->travel(25)->hours();
        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $this->assertCount(1, $this->remindersFor($profile));
    }

    public function test_it_stops_after_three_nudges(): void
    {
        $profile = $this->applicant([], 20);

        // Five sweeps spaced past the gap; only three may land, and the run must
        // stay inside the give-up window for the attempts to even be considered.
        for ($i = 0; $i < 5; $i++) {
            $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();
            $this->travel(49)->hours();
        }

        $this->assertCount(3, $this->remindersFor($profile));
    }

    /**
     * A reminder that arrives forever is worse than one that closes the loop,
     * so the last one says it is the last one.
     */
    public function test_the_final_nudge_says_it_is_the_last(): void
    {
        $profile = $this->applicant([], 20);

        for ($i = 0; $i < 3; $i++) {
            $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();
            $this->travel(49)->hours();
        }

        $bodies = $this->remindersFor($profile)->pluck('body');
        $this->assertTrue(
            $bodies->contains(fn ($b) => str_contains($b, 'last reminder')),
            'the third nudge should tell the runner it is the last',
        );
    }

    /**
     * Telling someone to "add" a document they already sent reads as though we
     * lost it. A rejected document needs replacing, and the copy must say so.
     */
    public function test_a_rejected_document_gets_replacement_copy_not_upload_copy(): void
    {
        $profile = $this->applicant(['selfie'], 48, 'runner', ['government_id']);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $reminder = $this->remindersFor($profile)->first();
        $this->assertNotNull($reminder);
        $this->assertStringContainsString('couldn’t accept', $reminder->body);
        $this->assertStringNotContainsString('finish signing up', strtolower($reminder->body));
    }

    /**
     * The tap has to land on the document screen. The app routes on the
     * persisted `type` column, and it maps this one alongside document_update.
     */
    public function test_the_reminder_is_typed_so_the_tap_lands_on_the_document_screen(): void
    {
        $profile = $this->applicant([]);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $reminder = $this->remindersFor($profile)->first();
        $this->assertSame('onboarding_reminder', $reminder->type);
        // Exactly ONE inbox row per nudge — sending under document_update and
        // writing a second row for the cadence history would show two.
        $this->assertSame(1, Notification::where('user_id', $profile->user_id)->count());
    }

    public function test_dry_run_sends_nothing(): void
    {
        $profile = $this->applicant([]);

        $this->artisan('errandguy:send-onboarding-reminders --dry-run')->assertSuccessful();

        $this->assertCount(0, $this->remindersFor($profile));
        Http::assertNothingSent();
    }

    public function test_an_approved_runner_is_not_an_applicant(): void
    {
        $profile = $this->applicant([]);
        $profile->update(['verification_status' => 'approved']);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $this->assertCount(0, $this->remindersFor($profile));
    }

    /**
     * Our review latency must not eat the runner's reminders.
     *
     * The window used to be anchored on signup, so a runner who submitted on
     * day 1 and was REJECTED on day 20 became `awaitingDocuments` again — needing
     * to re-upload — while sitting permanently outside a 14-day signup window.
     * The reminders meant for exactly that case never fired. It is now anchored
     * on the last time the ball landed in the runner's court.
     */
    public function test_a_late_rejection_reopens_the_nudge_window(): void
    {
        // Signed up 40 days ago — far outside any signup-anchored window.
        $profile = $this->applicant(['selfie'], 24 * 40, 'runner', ['government_id']);
        // …but we only rejected their ID yesterday.
        RunnerDocument::where('runner_id', $profile->id)
            ->where('status', 'rejected')
            ->update(['reviewed_at' => now()->subDay()]);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $reminders = $this->remindersFor($profile);
        $this->assertCount(1, $reminders, 'a freshly rejected document must still be chased');
        $this->assertStringContainsString('couldn’t accept', $reminders->first()->body);
    }

    /**
     * The other half of the same bug: the 3-nudge allowance was counted
     * all-time, so a runner who used it up before submitting had none left for
     * the re-upload a later rejection asks for. A rejection is a new ask.
     */
    public function test_a_rejection_grants_a_fresh_nudge_allowance(): void
    {
        $profile = $this->applicant([], 24 * 40);

        // Burn the full allowance against the original application.
        for ($i = 0; $i < 3; $i++) {
            Notification::create([
                'user_id' => $profile->user_id,
                'type' => 'onboarding_reminder',
                'title' => 'Finish signing up',
                'body' => 'old nudge',
            ]);
        }
        Notification::where('user_id', $profile->user_id)
            ->update(['created_at' => now()->subDays(35)]);

        // Then they submitted, and we rejected it yesterday.
        RunnerDocument::create([
            'runner_id' => $profile->id,
            'document_type' => 'government_id',
            'file_url' => 'kyc/id.jpg',
            'status' => 'rejected',
            'reviewed_at' => now()->subDay(),
        ]);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        // Three old + one new: the rejection earned its own allowance.
        $this->assertCount(4, $this->remindersFor($profile));
    }

    /**
     * The anchor must not become a loophole: an application that was never
     * reviewed still ages out on signup, exactly as before.
     */
    public function test_an_unreviewed_application_still_ages_out(): void
    {
        $profile = $this->applicant([], 24 * 40);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $this->assertCount(0, $this->remindersFor($profile));
    }

    public function test_a_suspended_account_is_not_nudged(): void
    {
        $profile = $this->applicant([]);
        User::whereKey($profile->user_id)->update(['status' => 'suspended']);

        $this->artisan('errandguy:send-onboarding-reminders')->assertSuccessful();

        $this->assertCount(0, $this->remindersFor($profile));
    }
}
