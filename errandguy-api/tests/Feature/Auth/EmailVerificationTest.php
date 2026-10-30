<?php

namespace Tests\Feature\Auth;

use App\Mail\OneTimeCode;
use App\Models\User;
use App\Services\OTPService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * "Verify later": a signed-in user confirms their email with a 6-digit code
 * (OTPService, purpose email_verification). The profile exposes
 * email_verified as a boolean, and changing the email clears it.
 */
class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->user = User::factory()->create([
            'email' => 'verify@example.com',
            'email_verified' => false,
            'status' => 'active',
        ]);
    }

    private function sendCode(): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($this->user)->postJson('/api/v1/user/email/send-code');
    }

    private function sentCode(): string
    {
        $code = null;
        Mail::assertSent(OneTimeCode::class, function (OneTimeCode $mail) use (&$code) {
            $code = $mail->code;

            return $mail->hasTo('verify@example.com') && $mail->purpose === OTPService::EMAIL_VERIFICATION;
        });

        return (string) $code;
    }

    public function test_the_profile_exposes_email_verified_as_a_boolean(): void
    {
        $this->actingAs($this->user)->getJson('/api/v1/user/profile')
            ->assertOk()
            ->assertJsonPath('data.email_verified', false);
    }

    public function test_a_code_is_emailed_and_confirms_the_address(): void
    {
        $this->sendCode()->assertOk()->assertJsonPath('data.email_verified', false);

        $code = $this->sentCode();
        $this->assertStringNotContainsStringIgnoringCase('link', (new OneTimeCode($code, OTPService::EMAIL_VERIFICATION))->render());

        $this->actingAs($this->user)->postJson('/api/v1/user/email/verify', ['code' => $code])
            ->assertOk()
            ->assertJsonPath('data.email_verified', true);

        $this->assertTrue($this->user->fresh()->email_verified);
        $this->actingAs($this->user)->getJson('/api/v1/user/profile')->assertJsonPath('data.email_verified', true);
    }

    public function test_a_wrong_code_is_rejected_with_the_guesses_left(): void
    {
        $this->sendCode();
        $code = $this->sentCode();
        $wrong = $code === '000000' ? '111111' : '000000';

        $this->actingAs($this->user)->postJson('/api/v1/user/email/verify', ['code' => $wrong])
            ->assertStatus(422)
            ->assertJsonPath('code', 'OTP_INVALID')
            ->assertJsonPath('attempts_remaining', OTPService::MAX_ATTEMPTS - 1);

        $this->assertFalse($this->user->fresh()->email_verified);
    }

    public function test_a_code_without_a_send_is_expired(): void
    {
        $this->actingAs($this->user)->postJson('/api/v1/user/email/verify', ['code' => '123456'])
            ->assertStatus(422)
            ->assertJsonPath('code', 'OTP_EXPIRED');
    }

    public function test_a_code_sent_to_the_old_address_does_not_confirm_a_new_one(): void
    {
        $this->sendCode();
        $code = $this->sentCode();

        $this->actingAs($this->user)->putJson('/api/v1/user/profile', ['email' => 'changed@example.com'])->assertOk();

        $this->actingAs($this->user->fresh())->postJson('/api/v1/user/email/verify', ['code' => $code])
            ->assertStatus(422);
        $this->assertFalse($this->user->fresh()->email_verified);
    }

    public function test_changing_the_email_clears_the_verified_flag(): void
    {
        $this->user->update(['email_verified' => true]);

        $this->actingAs($this->user)->putJson('/api/v1/user/profile', ['email' => 'changed@example.com'])
            ->assertOk()
            ->assertJsonPath('data.email_verified', false);
    }

    public function test_an_already_confirmed_address_gets_no_new_code(): void
    {
        $this->user->update(['email_verified' => true]);

        $this->sendCode()->assertOk()->assertJsonPath('data.email_verified', true);
        Mail::assertNothingSent();
    }

    public function test_an_account_without_an_email_is_told_to_add_one(): void
    {
        $this->user->update(['email' => null, 'phone' => '+639171234567']);

        $this->sendCode()->assertStatus(422)->assertJsonValidationErrors(['email']);
        Mail::assertNothingSent();
    }

    public function test_code_requests_are_capped(): void
    {
        for ($i = 0; $i < 3; $i++) {
            $this->sendCode()->assertOk();
        }

        $this->sendCode()->assertStatus(429);
    }

    public function test_both_endpoints_require_sign_in(): void
    {
        $this->postJson('/api/v1/user/email/send-code')->assertStatus(401);
        $this->postJson('/api/v1/user/email/verify', ['code' => '123456'])->assertStatus(401);
    }
}
