<?php

namespace Tests\Feature\Admin;

use App\Exceptions\PayoutStateException;
use App\Filament\Pages\Payouts;
use App\Models\AdminAlert;
use App\Models\AdminUser;
use App\Models\Notification;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Services\PaymentService;
use App\Services\WalletService;
use App\Support\PayoutDestination;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\TestCase;

/**
 * A payout must never be paid twice.
 *
 * "Mark failed" re-credits the wallet. It used to be offered for a payout
 * already sent to Xendit, so a staff member could refill the wallet while
 * Xendit went on to pay it — and the later "paid" notice was ignored. Now a
 * sent payout is shown as "Sent to Xendit" with its reference, only a fresh
 * Xendit lookup (or the webhook) can fail it, and a "paid" notice for a payout
 * already marked failed raises a critical staff alert.
 */
class PayoutSafetyTest extends TestCase
{
    use RefreshDatabase;

    private User $runner;

    /** What Xendit says about each payout, by our transaction id. */
    private array $xendit = [];

    /** How Xendit answers a send: 'ok' | 'reject' | 'timeout' | 'error'. */
    private string $sendOutcome = 'ok';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.xendit.secret_key' => 'test-secret', 'services.xendit.webhook_token' => 'test-webhook-token']);

        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'wallet_balance' => 200, 'full_name' => 'Rhea Runner']);
        RunnerProfile::create([
            'user_id' => $this->runner->id, 'verification_status' => 'approved', 'preferred_types' => [],
            'payout_channel' => 'gcash', 'ewallet_number' => '09171234567', 'payout_account_name' => 'Rhea Runner',
        ]);

        $this->actingAs(AdminUser::forceCreate([
            'email' => 'finance@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Finance', 'role' => 'finance', 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]), 'admin');

        Http::fake(function ($request) {
            $url = $request->url();
            $path = (string) parse_url($url, PHP_URL_PATH);

            if ($request->method() === 'POST' && $path === '/v2/payouts') {
                return match ($this->sendOutcome) {
                    'reject' => Http::response(['message' => 'Invalid account number'], 400),
                    'error' => Http::response(['message' => 'Internal error'], 500),
                    'duplicate' => Http::response(['error_code' => 'DUPLICATE_ERROR', 'message' => 'A payout with this reference already exists'], 409),
                    'timeout' => throw new ConnectionException('timed out'),
                    default => Http::response(['id' => 'disb-'.substr($request['reference_id'], 7), 'status' => 'ACCEPTED']),
                };
            }

            if ($request->method() === 'GET' && $path === '/v2/payouts') {
                parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
                $txId = substr((string) ($query['reference_id'] ?? ''), 7);

                return Http::response(isset($this->xendit[$txId]) ? [['id' => "disb-{$txId}", ...$this->xendit[$txId]]] : []);
            }

            if ($request->method() === 'GET' && str_starts_with($path, '/v2/payouts/')) {
                $txId = substr(basename($path), 5);

                return Http::response(['id' => basename($path), ...($this->xendit[$txId] ?? ['status' => 'ACCEPTED'])]);
            }

            return Http::response([], 404);
        });
    }

    /** Sending a payout to an account not on record takes a super admin. */
    private function asSuperAdmin(): void
    {
        $this->actingAs(AdminUser::forceCreate([
            'email' => 'boss@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Boss', 'role' => 'super_admin', 'is_active' => true,
            'has_email_authentication' => true,
        ]), 'admin');
    }

    /** A pending ₱300 payout (the wallet is already debited to 200). */
    private function pendingPayout(array $overrides = []): WalletTransaction
    {
        return WalletTransaction::create(array_merge([
            'user_id' => $this->runner->id, 'type' => 'payout', 'amount' => -300, 'balance_after' => 200,
            'status' => 'pending', 'description' => 'Payout request',
            'payout_destination' => PayoutDestination::make('gcash', '09171234567', 'Rhea Runner'),
        ], $overrides));
    }

    private function sentPayout(): WalletTransaction
    {
        $tx = $this->pendingPayout();
        app(PaymentService::class)->createPayout($tx->id, 'PH_GCASH', '09171234567', 'Rhea Runner');

        return $tx->fresh();
    }

    public function test_sending_marks_the_payout_sent_and_records_where_it_went(): void
    {
        $tx = $this->sentPayout();

        $this->assertNotNull($tx->payout_sent_at);
        $this->assertSame("disb-{$tx->id}", $tx->gateway_ref);
        $this->assertSame('pending', $tx->status);
        $this->assertSame('PH_GCASH', $tx->payout_destination['channel_code']);
        $this->assertSame('09171234567', $tx->payout_destination['account_number']);
        Http::assertSent(fn ($r) => $r->method() === 'POST'
            && $r->hasHeader('Idempotency-key', "po-{$tx->id}")
            && $r['reference_id'] === "payout-{$tx->id}");
    }

    public function test_a_sent_payout_shows_as_sent_with_its_reference_and_offers_no_manual_override(): void
    {
        $tx = $this->sentPayout();

        Livewire::test(Payouts::class)
            ->assertTableColumnFormattedStateSet('status', 'Sent to Xendit', $tx)
            ->assertTableColumnStateSet('gateway_ref', "disb-{$tx->id}", $tx)
            ->assertTableActionHidden('fail', $tx)
            ->assertTableActionHidden('complete', $tx)
            ->assertTableActionHidden('sendViaXendit', $tx)
            ->assertTableActionVisible('checkWithXendit', $tx);
    }

    public function test_a_sent_payout_can_never_be_failed_by_hand(): void
    {
        $tx = $this->sentPayout();

        try {
            app(WalletService::class)->failPayout($tx->id, 'staff said so');
            $this->fail('A sent payout was failed by hand.');
        } catch (PayoutStateException $e) {
            $this->assertStringContainsString('only Xendit can say it failed', $e->getMessage());
        }

        $this->assertSame('pending', $tx->fresh()->status);
        $this->assertEquals(200.0, (float) $this->runner->fresh()->wallet_balance, 'nothing re-credited');
    }

    public function test_an_unanswered_send_still_counts_as_sent(): void
    {
        $tx = $this->pendingPayout();
        $this->sendOutcome = 'timeout';

        try {
            app(PaymentService::class)->createPayout($tx->id, 'PH_GCASH', '09171234567', 'Rhea Runner');
            $this->fail('The unanswered send was reported as fine.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('Check with Xendit', $e->getMessage());
        }

        $tx->refresh();
        $this->assertNull($tx->gateway_ref);
        $this->assertTrue($tx->isSentToGateway());
        $this->expectException(PayoutStateException::class);
        app(WalletService::class)->failPayout($tx->id, 'gave up');
    }

    public function test_a_server_error_on_send_also_stays_sent_but_a_rejection_does_not(): void
    {
        $errored = $this->pendingPayout();
        $this->sendOutcome = 'error';
        try {
            app(PaymentService::class)->createPayout($errored->id, 'PH_GCASH', '09171234567', 'Rhea Runner');
        } catch (\RuntimeException) {
        }
        $this->assertTrue($errored->fresh()->isSentToGateway());

        // A 4xx is a definite "no": nothing was created, so it is not sent and
        // can be corrected — or failed by hand.
        $rejected = $this->pendingPayout();
        $this->sendOutcome = 'reject';
        try {
            app(PaymentService::class)->createPayout($rejected->id, 'PH_GCASH', '0917', 'Rhea Runner');
        } catch (\RuntimeException $e) {
            $this->assertSame('Invalid account number', $e->getMessage());
        }
        $this->assertFalse($rejected->fresh()->isSentToGateway());
        app(WalletService::class)->failPayout($rejected->id, 'wrong number');
        $this->assertSame('failed', $rejected->fresh()->status);
    }

    public function test_a_duplicate_answer_means_the_payout_exists_so_it_stays_sent(): void
    {
        // 409 is a 4xx, but it says a payout under this reference already
        // exists at Xendit. Releasing it as "not sent" would let staff send it
        // a second time, or fail it by hand and refill the wallet.
        $tx = $this->pendingPayout();
        $this->sendOutcome = 'duplicate';
        try {
            app(PaymentService::class)->createPayout($tx->id, 'PH_GCASH', '09171234567', 'Rhea Runner');
        } catch (\RuntimeException) {
        }

        $this->assertTrue($tx->fresh()->isSentToGateway());
        $this->expectException(\RuntimeException::class);
        app(WalletService::class)->failPayout($tx->id, 'staff thinks it never went');
    }

    public function test_a_payout_is_never_sent_twice(): void
    {
        $tx = $this->sentPayout();

        $this->expectExceptionMessage('already sent to Xendit');
        app(PaymentService::class)->createPayout($tx->id, 'PH_GCASH', '09171234567', 'Rhea Runner');
    }

    public function test_check_with_xendit_fails_it_only_when_xendit_says_so(): void
    {
        $tx = $this->sentPayout();

        // Still in flight: nothing moves.
        $this->xendit[$tx->id] = ['status' => 'ACCEPTED'];
        Livewire::test(Payouts::class)->callTableAction('checkWithXendit', $tx);
        $this->assertSame('pending', $tx->fresh()->status);
        $this->assertEquals(200.0, (float) $this->runner->fresh()->wallet_balance);

        // Xendit says it failed: re-credited once, and the runner is told.
        $this->xendit[$tx->id] = ['status' => 'FAILED', 'failure_code' => 'INVALID_DESTINATION'];
        Livewire::test(Payouts::class)->callTableAction('checkWithXendit', $tx);

        $this->assertSame('failed', $tx->fresh()->status);
        $this->assertEquals(500.0, (float) $this->runner->fresh()->wallet_balance);
        $this->assertTrue(Notification::where('user_id', $this->runner->id)->where('title', 'Payout couldn’t be sent')->exists());
    }

    public function test_check_with_xendit_completes_a_paid_payout(): void
    {
        $tx = $this->sentPayout();
        $this->xendit[$tx->id] = ['status' => 'SUCCEEDED'];

        Livewire::test(Payouts::class)->callTableAction('checkWithXendit', $tx);

        $this->assertSame('completed', $tx->fresh()->status);
        $this->assertEquals(200.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_check_with_xendit_finds_an_unanswered_send_by_its_reference(): void
    {
        $tx = $this->pendingPayout();
        $this->sendOutcome = 'timeout';
        try {
            app(PaymentService::class)->createPayout($tx->id, 'PH_GCASH', '09171234567', 'Rhea Runner');
        } catch (\RuntimeException) {
        }

        $this->xendit[$tx->id] = ['status' => 'SUCCEEDED'];
        Livewire::test(Payouts::class)->callTableAction('checkWithXendit', $tx);

        $tx->refresh();
        $this->assertSame("disb-{$tx->id}", $tx->gateway_ref);
        $this->assertSame('completed', $tx->status);
    }

    public function test_an_unanswered_send_xendit_never_heard_of_is_released_only_after_the_grace_window(): void
    {
        $tx = $this->pendingPayout();
        $this->sendOutcome = 'timeout';
        try {
            app(PaymentService::class)->createPayout($tx->id, 'PH_GCASH', '09171234567', 'Rhea Runner');
        } catch (\RuntimeException) {
        }

        // Moments later Xendit may still be creating it: stays sent.
        Livewire::test(Payouts::class)->callTableAction('checkWithXendit', $tx);
        $this->assertTrue($tx->fresh()->isSentToGateway());

        // Well after: Xendit has no record, so it was never sent.
        $tx->forceFill(['payout_sent_at' => now()->subMinutes(WalletService::UNANSWERED_SEND_GRACE_MINUTES + 1)])->save();
        Livewire::test(Payouts::class)->callTableAction('checkWithXendit', $tx);

        $tx->refresh();
        $this->assertFalse($tx->isSentToGateway());
        $this->assertSame('pending', $tx->status);
        $this->assertEquals(200.0, (float) $this->runner->fresh()->wallet_balance, 'releasing it moves no money');
    }

    public function test_the_payout_webhook_can_still_fail_a_sent_payout(): void
    {
        $tx = $this->sentPayout();

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payout.failed',
            'data' => ['id' => $tx->gateway_ref, 'reference_id' => "payout-{$tx->id}", 'failure_code' => 'ACCOUNT_CLOSED'],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertSame('failed', $tx->fresh()->status);
        $this->assertEquals(500.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_a_paid_notice_for_a_payout_already_failed_raises_one_critical_alert(): void
    {
        // An unsent payout failed by hand (allowed: nothing went to Xendit)...
        $tx = $this->pendingPayout();
        app(WalletService::class)->failPayout($tx->id, 'manual');
        $this->assertEquals(500.0, (float) $this->runner->fresh()->wallet_balance);

        // ...that Xendit then reports PAID after all.
        foreach (['wh-1', 'wh-2'] as $webhookId) {
            $this->postJson('/api/v1/webhooks/xendit', [
                'event' => 'payout.succeeded',
                'data' => ['id' => 'disb-x', 'reference_id' => "payout-{$tx->id}"],
            ], ['x-callback-token' => 'test-webhook-token', 'webhook-id' => $webhookId])->assertOk();
        }

        $alerts = AdminAlert::where('type', 'payout_paid_after_failed')->get();
        $this->assertCount(1, $alerts);
        $this->assertSame('critical', $alerts->first()->severity);
        $this->assertSame($tx->id, $alerts->first()->subject_id);
        // The ledger is left as it was — recovering the money is a person's call.
        $this->assertSame('failed', $tx->fresh()->status);
        $this->assertEquals(500.0, (float) $this->runner->fresh()->wallet_balance);

        // It is on the dashboard's live alerts, linked to the Payouts page.
        Livewire::test(\App\Filament\Widgets\LiveAlertsWidget::class)
            ->assertSee('Payout paid after it was marked failed')
            ->assertSee(Payouts::getUrl(), false);
    }

    public function test_marking_paid_by_hand_is_refused_once_a_colleague_sent_it_through_xendit(): void
    {
        // The button was shown while the payout was unsent; a colleague's
        // "Send via Xendit" landed before the confirm.
        $tx = $this->pendingPayout();
        $tx->update(['payout_sent_at' => now()]);

        try {
            app(WalletService::class)->completePayout($tx->id, byHand: true);
            $this->fail('A payout sent through Xendit was also marked paid by hand.');
        } catch (\App\Exceptions\PayoutStateException) {
            // expected
        }
        $this->assertSame('pending', $tx->fresh()->status);

        // Xendit's own confirmation still completes it.
        app(WalletService::class)->completePayout($tx->id);
        $this->assertSame('completed', $tx->fresh()->status);
    }

    public function test_a_stale_paid_notice_for_a_payout_since_reversed_is_not_called_paid_twice(): void
    {
        // Ours missed the "succeeded"; the bank then reversed it and the
        // reversal failed the payout (money back in the wallet). Xendit's
        // retry of the old "succeeded" is not a second payment.
        $tx = $this->pendingPayout();
        app(WalletService::class)->failPayout($tx->id, 'REVERSED');
        $this->xendit[$tx->id] = ['status' => 'REVERSED'];

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payout.succeeded',
            'data' => ['id' => "disb-{$tx->id}", 'reference_id' => "payout-{$tx->id}"],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        $this->assertSame(0, AdminAlert::where('type', 'payout_paid_after_failed')->count());
        $this->assertEquals(500.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_a_reversal_that_loses_a_race_to_the_paid_notice_still_returns_the_money(): void
    {
        $tx = $this->sentPayout();

        // payout.reversed read the payout as pending; payout.succeeded then
        // completed it before failPayout took its lock.
        $this->app->instance(WalletService::class, new class extends WalletService
        {
            public function failPayout(string $txId, string $reason, bool $confirmedByGateway = false): WalletTransaction
            {
                WalletTransaction::whereKey($txId)->update(['status' => 'completed']);

                return parent::failPayout($txId, $reason, $confirmedByGateway);
            }
        });

        $this->postJson('/api/v1/webhooks/xendit', [
            'event' => 'payout.reversed',
            'data' => ['id' => $tx->gateway_ref, 'reference_id' => "payout-{$tx->id}", 'status' => 'REVERSED'],
        ], ['x-callback-token' => 'test-webhook-token'])->assertOk();

        // Used to be swallowed: the money came back to us, the runner stayed debited.
        $this->assertSame('reversed', $tx->fresh()->status);
        $this->assertEquals(500.0, (float) $this->runner->fresh()->wallet_balance);
    }

    public function test_send_via_xendit_prefills_the_recorded_destination_and_logs_it(): void
    {
        $tx = $this->pendingPayout([
            'payout_destination' => PayoutDestination::make('maya', '09281112222', 'Rhea R.'),
        ]);

        Livewire::test(Payouts::class)
            ->mountTableAction('sendViaXendit', $tx)
            ->assertTableActionDataSet([
                'channel_code' => 'PH_PAYMAYA',
                'account_number' => '09281112222',
                'account_holder_name' => 'Rhea R.',
            ])
            ->callMountedTableAction()
            ->assertHasNoTableActionErrors();

        $activity = Activity::where('event', 'payout.sent')->where('subject_id', $tx->id)->firstOrFail();
        $this->assertSame('maya', $activity->properties['channel']);
        $this->assertSame('PH_PAYMAYA', $activity->properties['channel_code']);
        // Masked: the audit log is open to the admin role (no money access).
        $this->assertSame('Maya •••• 2222', $activity->properties['to']);
        $this->assertArrayNotHasKey('account_number', $activity->properties->all());
    }

    public function test_a_payout_requested_before_destinations_were_recorded_prefills_from_the_profile(): void
    {
        $tx = $this->pendingPayout(['payout_destination' => null]);

        Livewire::test(Payouts::class)
            ->mountTableAction('sendViaXendit', $tx)
            ->assertTableActionDataSet([
                'channel_code' => 'PH_GCASH',
                'account_number' => '09171234567',
                'account_holder_name' => 'Rhea Runner',
            ]);
    }

    public function test_pay_a_runner_records_the_destination_in_the_activity_log(): void
    {
        $this->asSuperAdmin();
        Livewire::test(Payouts::class)
            ->callAction('payRunner', [
                'user_id' => $this->runner->id,
                'amount' => 150,
                'channel_code' => 'PH_BDO',
                'account_number' => '001234567890',
                'account_holder_name' => 'Rhea Runner',
                // Not the GCash account she saved, so it needs a reason.
                'change_reason' => 'Runner asked to be paid to her bank this time',
            ])
            ->assertHasNoActionErrors();

        $tx = WalletTransaction::where('user_id', $this->runner->id)->where('type', 'payout')->firstOrFail();
        $this->assertEquals(-150.0, (float) $tx->amount);
        $this->assertTrue($tx->isSentToGateway());

        $activity = Activity::where('event', 'payout.admin_initiated')->firstOrFail();
        $this->assertSame('bank', $activity->properties['channel']);
        $this->assertSame('PH_BDO', $activity->properties['channel_code']);
        $this->assertStringEndsWith('•••• 7890', $activity->properties['to']);
        $this->assertStringNotContainsString('001234567890', json_encode($activity->properties));
    }

    public function test_pay_a_runner_that_xendit_rejects_says_the_money_already_moved(): void
    {
        // The debit and the pending payout are made before the send. When
        // Xendit then rejects it, staff used to see only "Could not send
        // payout" — so they tried again and the runner was debited twice.
        $this->sendOutcome = 'reject';

        Livewire::test(Payouts::class)
            ->callAction('payRunner', [
                'user_id' => $this->runner->id,
                'amount' => 150,
                'channel_code' => 'PH_GCASH',
                'account_number' => '09171234567',
                'account_holder_name' => 'Rhea Runner',
            ])
            ->assertNotified('Payout created, but not sent');

        $tx = WalletTransaction::where('user_id', $this->runner->id)->where('type', 'payout')->sole();
        $this->assertSame('pending', $tx->status);
        $this->assertFalse($tx->isSentToGateway());
        $this->assertEquals(50.0, (float) $this->runner->fresh()->wallet_balance);

        $activity = Activity::where('event', 'payout.admin_initiated')->where('subject_id', $tx->id)->sole();
        $this->assertFalse($activity->properties['sent']);
    }

    public function test_sending_to_a_different_account_needs_a_reason_and_alerts_finance(): void
    {
        $this->asSuperAdmin();
        $tx = $this->pendingPayout(); // requested to GCash 09171234567

        // Changed with no reason: nothing goes out.
        Livewire::test(Payouts::class)
            ->callTableAction('sendViaXendit', $tx, [
                'channel_code' => 'PH_GCASH', 'account_number' => '09998887777', 'account_holder_name' => 'Someone Else',
            ])
            ->assertNotified('Say why the account changed');
        $this->assertFalse($tx->fresh()->isSentToGateway());
        $this->assertSame(0, \App\Models\AdminAlert::where('type', 'payout_destination_changed')->count());

        // Changed with a reason: sent, alerted and audited.
        Livewire::test(Payouts::class)
            ->callTableAction('sendViaXendit', $tx, [
                'channel_code' => 'PH_GCASH', 'account_number' => '09998887777', 'account_holder_name' => 'Rhea Runner',
                'change_reason' => 'Runner called: old SIM lost',
            ]);
        $this->assertTrue($tx->fresh()->isSentToGateway());
        $alert = \App\Models\AdminAlert::where('type', 'payout_destination_changed')->sole();
        $this->assertStringContainsString('old SIM lost', $alert->body);
        $this->assertTrue(Activity::where('event', 'payout.sent')->where('subject_id', $tx->id)->sole()->properties['destination_changed']);
    }

    public function test_pay_a_runner_to_an_account_they_did_not_save_needs_a_reason_and_alerts(): void
    {
        $this->asSuperAdmin();
        $form = [
            'user_id' => $this->runner->id,
            'amount' => 100,
            'channel_code' => 'PH_GCASH',
            'account_number' => '09998887777', // she saved 09171234567
            'account_holder_name' => 'Someone Else',
        ];

        Livewire::test(Payouts::class)
            ->callAction('payRunner', $form)
            ->assertNotified('Say why the account changed');
        // Refused before any money moved.
        $this->assertSame(0, WalletTransaction::where('user_id', $this->runner->id)->where('type', 'payout')->count());
        $this->assertEquals(200.0, (float) $this->runner->fresh()->wallet_balance);

        Livewire::test(Payouts::class)
            ->callAction('payRunner', [...$form, 'change_reason' => 'Runner called from a new number']);
        $this->assertSame(1, WalletTransaction::where('user_id', $this->runner->id)->where('type', 'payout')->count());
        $alert = \App\Models\AdminAlert::where('type', 'payout_destination_changed')->sole();
        $this->assertSame('Payout sent to a different account', $alert->title);
        $this->assertStringContainsString('new number', $alert->body);
    }

    public function test_a_rejected_send_to_a_different_account_is_still_flagged_as_an_attempt(): void
    {
        $this->asSuperAdmin();
        $this->sendOutcome = 'reject';
        $tx = $this->pendingPayout();

        Livewire::test(Payouts::class)->callTableAction('sendViaXendit', $tx, [
            'channel_code' => 'PH_GCASH', 'account_number' => '09998887777', 'account_holder_name' => 'Rhea Runner',
            'change_reason' => 'Runner called: old SIM lost',
        ]);

        $alert = \App\Models\AdminAlert::where('type', 'payout_destination_changed')->sole();
        $this->assertSame('Payout to a different account tried', $alert->title);
        $this->assertStringContainsString('Xendit refused it', $alert->body);
    }

    public function test_finance_cannot_send_a_payout_to_an_account_not_on_record_or_clear_the_alert(): void
    {
        // As finance (setUp): someone's withdrawal sent to an account of the
        // staff member's choosing is refused before anything is sent.
        $tx = $this->pendingPayout();
        Livewire::test(Payouts::class)
            ->callTableAction('sendViaXendit', $tx, [
                'channel_code' => 'PH_GCASH', 'account_number' => '09998887777', 'account_holder_name' => 'Me',
                'change_reason' => 'Runner asked',
            ])
            ->assertNotified('A super admin has to approve this account');
        $this->assertFalse($tx->fresh()->isSentToGateway());

        // Nor can money staff clear an alert about themselves.
        \App\Models\AdminAlert::raise(\App\Services\StaffMoneyLimit::ALERT_DESTINATION, 'warning', 'Payout sent to a different account', 'x');
        $alert = \App\Models\AdminAlert::sole();
        $this->assertFalse(\App\Filament\Widgets\LiveAlertsWidget::canDismiss($alert));
        $this->asSuperAdmin();
        $this->assertTrue(\App\Filament\Widgets\LiveAlertsWidget::canDismiss($alert));
    }

    public function test_the_same_account_typed_differently_is_not_a_change(): void
    {
        $this->assertFalse(Payouts::destinationChanged(
            PayoutDestination::make('gcash', '09171234567', 'Rhea Runner'), 'PH_GCASH', '+63 917 123 4567',
        ));
        $this->assertTrue(Payouts::destinationChanged(
            PayoutDestination::make('gcash', '09171234567', 'Rhea Runner'), 'PH_PAYMAYA', '09171234567',
        ));
    }

    public function test_a_payout_completed_by_hand_records_how_it_was_paid(): void
    {
        $tx = $this->pendingPayout();

        Livewire::test(Payouts::class)
            ->callTableAction('complete', $tx, ['paid_how' => ''])
            ->assertHasTableActionErrors(['paid_how' => 'required']);
        $this->assertSame('pending', $tx->fresh()->status);

        Livewire::test(Payouts::class)
            ->callTableAction('complete', $tx, ['paid_how' => 'GCash to 0917 123 4567, ref 99887766'])
            ->assertHasNoTableActionErrors();
        $this->assertSame('completed', $tx->fresh()->status);
        $this->assertSame(
            'GCash to 0917 123 4567, ref 99887766',
            Activity::where('event', 'payout.completed')->where('subject_id', $tx->id)->sole()->properties['paid_how'],
        );
    }

    public function test_finance_can_export_payouts_and_the_badge_counts_only_unsent_ones(): void
    {
        $this->pendingPayout();
        $this->sentPayout();
        \App\Support\AdminCache::flush();

        Livewire::test(Payouts::class)->assertTableActionVisible('exportCsv');
        $this->assertSame('1', Payouts::getNavigationBadge());
    }

    public function test_the_bulk_send_button_is_gone(): void
    {
        $this->pendingPayout();

        Livewire::test(Payouts::class)->assertTableBulkActionDoesNotExist('sendSelectedViaXendit');
    }
}
