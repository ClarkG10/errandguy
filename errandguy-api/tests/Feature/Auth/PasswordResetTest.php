<?php

namespace Tests\Feature\Auth;

use App\Mail\OneTimeCode;
use App\Models\DeviceToken;
use App\Models\User;
use App\Services\OTPService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Password reset is an account-takeover surface. It works with a 6-digit code
 * emailed to the account (never a link the app can't open): forgot-password
 * answers the same whether or not the address has an account, a valid code
 * resets the password and signs the account out everywhere (tokens AND push
 * registrations), a code is single-use, and guessing is bounded per code and
 * per address.
 */
class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->user = User::factory()->create([
            'email' => 'reset@example.com',
            'password_hash' => Hash::make('OldPass1!'),
            'email_verified' => false,
            'fcm_token' => 'ExponentPushToken[old-phone]',
        ]);
    }

    private function forgot(string $email = 'reset@example.com'): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/auth/forgot-password', ['email' => $email]);
    }

    private function reset(string $code, string $password = 'NewPass1!', string $email = 'reset@example.com'): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/auth/reset-password', [
            'email' => $email,
            'code' => $code,
            'password' => $password,
            'password_confirmation' => $password,
        ]);
    }

    /** The code from the last reset email sent to the account. */
    private function sentCode(): string
    {
        $code = null;
        Mail::assertSent(OneTimeCode::class, function (OneTimeCode $mail) use (&$code) {
            $code = $mail->code;

            return $mail->hasTo('reset@example.com') && $mail->purpose === OTPService::PASSWORD_RESET;
        });

        return (string) $code;
    }

    private function wrongCode(string $code): string
    {
        return str_pad((string) (((int) $code + 1) % 1000000), 6, '0', STR_PAD_LEFT);
    }

    public function test_forgot_password_emails_a_six_digit_code_not_a_link(): void
    {
        $this->forgot()->assertOk()->assertJsonPath('success', true);

        $code = $this->sentCode();
        $this->assertMatchesRegularExpression('/^\d{6}$/', $code);

        $mail = new OneTimeCode($code, OTPService::PASSWORD_RESET);
        $text = $mail->render();
        $this->assertStringContainsString($code, $text);
        $this->assertStringContainsStringIgnoringCase('code', $text);
        $this->assertStringNotContainsStringIgnoringCase('link', $text);
        $this->assertStringNotContainsString('http', $text);
        $this->assertStringContainsStringIgnoringCase('code', $mail->envelope()->subject);
    }

    public function test_forgot_password_answers_the_same_for_an_unknown_email_and_sends_nothing(): void
    {
        $known = $this->forgot()->assertOk()->json();
        $unknown = $this->forgot('nobody@example.com')->assertOk()->json();

        $this->assertSame($known['message'], $unknown['message']);
        $this->assertSame($known['success'], $unknown['success']);
        Mail::assertSent(OneTimeCode::class, 1);
        Mail::assertNotSent(OneTimeCode::class, fn (OneTimeCode $mail) => $mail->hasTo('nobody@example.com'));
    }

    public function test_a_valid_code_resets_the_password_and_signs_out_everywhere(): void
    {
        $this->user->createToken('phone-a');
        $this->user->createToken('phone-b');
        DeviceToken::create(['user_id' => $this->user->id, 'token' => 'ExponentPushToken[old-phone]']);
        DeviceToken::create(['user_id' => $this->user->id, 'token' => 'ExponentPushToken[tablet]']);

        $this->forgot();
        $this->reset($this->sentCode())->assertOk();

        $user = $this->user->fresh();
        $this->assertTrue(Hash::check('NewPass1!', $user->password_hash));
        $this->assertSame(0, $user->tokens()->count());
        $this->assertSame(0, DeviceToken::where('user_id', $user->id)->count());
        $this->assertNull($user->fcm_token, 'the legacy push column would keep pushing to a signed-out phone');
        // The code reached the inbox, so the address is confirmed.
        $this->assertTrue($user->email_verified);
    }

    public function test_the_code_is_single_use(): void
    {
        $this->forgot();
        $code = $this->sentCode();
        $this->reset($code)->assertOk();

        $this->reset($code, 'Another1!')->assertStatus(422)->assertJsonPath('code', 'OTP_EXPIRED');
        $this->assertTrue(Hash::check('NewPass1!', $this->user->fresh()->password_hash));
    }

    public function test_an_expired_code_is_rejected(): void
    {
        $this->forgot();
        $code = $this->sentCode();

        $this->travel(OTPService::TTL_MINUTES + 1)->minutes();

        $this->reset($code)->assertStatus(422)->assertJsonPath('code', 'OTP_EXPIRED');
        $this->assertTrue(Hash::check('OldPass1!', $this->user->fresh()->password_hash));
    }

    public function test_a_wrong_code_is_rejected_and_reports_the_guesses_left(): void
    {
        $this->forgot();
        $code = $this->sentCode();

        $this->reset($this->wrongCode($code))
            ->assertStatus(422)
            ->assertJsonPath('code', 'OTP_INVALID')
            ->assertJsonPath('attempts_remaining', OTPService::MAX_ATTEMPTS - 1);

        $this->assertTrue(Hash::check('OldPass1!', $this->user->fresh()->password_hash));
        // The real code still works after a wrong guess.
        $this->reset($code)->assertOk();
    }

    public function test_a_code_dies_after_five_wrong_guesses_even_from_different_ips(): void
    {
        $this->forgot();
        $code = $this->sentCode();
        $wrong = $this->wrongCode($code);

        // Five guesses, each from its own IP (so the per-IP throttle never bites).
        for ($i = 1; $i <= OTPService::MAX_ATTEMPTS; $i++) {
            $this->withServerVariables(['REMOTE_ADDR' => "198.51.100.{$i}"])
                ->postJson('/api/v1/auth/reset-password', [
                    'email' => 'reset@example.com', 'code' => $wrong,
                    'password' => 'NewPass1!', 'password_confirmation' => 'NewPass1!',
                ])->assertStatus(422);
        }

        // The right code is now refused: the per-code limit is global.
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.99'])
            ->postJson('/api/v1/auth/reset-password', [
                'email' => 'reset@example.com', 'code' => $code,
                'password' => 'NewPass1!', 'password_confirmation' => 'NewPass1!',
            ])->assertStatus(422)->assertJsonPath('code', 'OTP_MAX_ATTEMPTS');

        $this->assertTrue(Hash::check('OldPass1!', $this->user->fresh()->password_hash));
    }

    public function test_reset_attempts_are_throttled_per_email_and_ip(): void
    {
        // auth-verify: 5 per 15 minutes for one address from one IP.
        for ($i = 0; $i < 5; $i++) {
            $this->reset('000000')->assertStatus(422);
        }

        $this->reset('000000')->assertStatus(429);
    }

    public function test_code_requests_are_capped_per_address_whether_or_not_it_has_an_account(): void
    {
        foreach (['reset@example.com', 'nobody@example.com'] as $email) {
            for ($i = 0; $i < 3; $i++) {
                $this->forgot($email)->assertOk();
            }
            $this->forgot($email)->assertStatus(429);
        }

        Mail::assertSent(OneTimeCode::class, 3);
    }

    public function test_a_new_code_replaces_the_old_one(): void
    {
        $this->forgot();
        $first = $this->sentCode();

        Mail::fake();
        $this->forgot();
        $second = $this->sentCode();

        if ($first !== $second) {
            $this->reset($first)->assertStatus(422);
        }
        $this->reset($second)->assertOk();
    }

    public function test_the_new_password_must_meet_the_strength_rules(): void
    {
        $this->forgot();

        $this->reset($this->sentCode(), 'weak')->assertStatus(422)->assertJsonValidationErrors(['password']);
        $this->assertTrue(Hash::check('OldPass1!', $this->user->fresh()->password_hash));
    }
}
