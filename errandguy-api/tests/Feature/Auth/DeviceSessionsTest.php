<?php

namespace Tests\Feature\Auth;

use App\Models\DeviceToken;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Services\OTPService;
use App\Services\UserModerationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Sign-ins and push registrations per device:
 *   - a sign-in carrying device_id is named by it, so a second phone of the
 *     same model no longer ends the first phone's sign-in;
 *   - sign-out drops this phone's push registration (by push token, or by the
 *     device_id it was registered from), sign-out-everywhere drops them all;
 *   - changing the password keeps this phone signed in and signs the others out;
 *   - suspension drops every push registration.
 */
class DeviceSessionsTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE_A = '6f1c2b8e-1111-4a5b-9c0d-aaaaaaaaaaaa';

    private const PHONE_B = '6f1c2b8e-2222-4a5b-9c0d-bbbbbbbbbbbb';

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create([
            'email' => 'devices@example.com',
            'password_hash' => Hash::make('Password1!'),
            'status' => 'active',
        ]);
    }

    private function login(array $extra = []): string
    {
        return $this->postJson('/api/v1/auth/login', array_merge([
            'email' => 'devices@example.com',
            'password' => 'Password1!',
        ], $extra))->assertOk()->json('token');
    }

    private function registerPush(string $bearer, string $pushToken, array $extra = []): void
    {
        $this->withToken($bearer)
            ->putJson('/api/v1/user/fcm-token', array_merge(['fcm_token' => $pushToken], $extra))
            ->assertOk();
        $this->app['auth']->forgetGuards();
    }

    private function tokenNames(): array
    {
        return $this->user->tokens()->pluck('name')->sort()->values()->all();
    }

    // ── Sign-in naming ────────────────────────────────────────────────

    public function test_two_phones_of_the_same_model_keep_their_own_sign_ins(): void
    {
        $this->login(['device_id' => self::PHONE_A, 'device_name' => 'Samsung SM-A155F · Android 14']);
        $this->login(['device_id' => self::PHONE_B, 'device_name' => 'Samsung SM-A155F · Android 14']);

        $this->assertSame([
            'device:'.self::PHONE_A.'|Samsung SM-A155F · Android 14',
            'device:'.self::PHONE_B.'|Samsung SM-A155F · Android 14',
        ], $this->tokenNames());
    }

    public function test_signing_in_again_on_the_same_phone_replaces_only_its_own_sign_in(): void
    {
        $first = $this->login(['device_id' => self::PHONE_A, 'device_name' => 'Pixel 7']);
        $this->login(['device_id' => self::PHONE_B, 'device_name' => 'Pixel 7']);
        $again = $this->login(['device_id' => self::PHONE_A, 'device_name' => 'Pixel 7']);

        $this->assertSame(2, $this->user->tokens()->count());
        $this->app['auth']->forgetGuards();
        $this->withToken($first)->getJson('/api/v1/user/profile')->assertStatus(401);
        $this->app['auth']->forgetGuards();
        $this->withToken($again)->getJson('/api/v1/user/profile')->assertOk();
    }

    public function test_another_account_on_the_same_phone_is_untouched(): void
    {
        $other = User::factory()->create(['email' => 'other@example.com', 'password_hash' => Hash::make('Password1!')]);
        $other->createToken('device:'.self::PHONE_A);

        $this->login(['device_id' => self::PHONE_A]);

        $this->assertSame(1, $other->tokens()->count());
    }

    public function test_without_a_device_id_the_old_naming_applies(): void
    {
        $this->login(['device_name' => 'Pixel 7']);
        $this->login(['device_name' => 'Pixel 7']);

        // Same name → replaced, exactly as before.
        $this->assertSame(['Pixel 7'], $this->tokenNames());
    }

    public function test_an_unusable_device_id_never_blocks_sign_in(): void
    {
        $this->login(['device_id' => 'bad id with spaces%', 'device_name' => 'Pixel 7']);

        $this->assertSame(['Pixel 7'], $this->tokenNames());
    }

    public function test_otp_sign_in_names_the_token_by_device(): void
    {
        Cache::put('otp:devices@example.com', Hash::make('123456'), now()->addMinutes(5));

        $this->postJson('/api/v1/auth/verify-otp', [
            'email' => 'devices@example.com',
            'code' => '123456',
            'device_id' => self::PHONE_A,
            'device_name' => 'iPhone 15 · iOS 18',
        ])->assertOk()->assertJsonStructure(['token']);

        $this->assertSame(['device:'.self::PHONE_A.'|iPhone 15 · iOS 18'], $this->tokenNames());
    }

    public function test_registration_names_the_token_by_device(): void
    {
        $this->postJson('/api/v1/auth/register', [
            'email' => 'new@example.com',
            'password' => 'Password1!',
            'full_name' => 'New Person',
            'device_id' => self::PHONE_A,
        ])->assertCreated();

        $this->assertSame(['device:'.self::PHONE_A], User::where('email', 'new@example.com')->first()->tokens()->pluck('name')->all());
    }

    // ── Sign-out ──────────────────────────────────────────────────────

    public function test_signing_out_of_the_last_sign_in_takes_a_runner_offline(): void
    {
        $profile = RunnerProfile::create([
            'user_id' => $this->user->id, 'verification_status' => 'approved',
            'vehicle_type' => 'motorcycle', 'preferred_types' => ['delivery'],
            'is_online' => true, 'online_since' => now(),
        ]);

        $a = $this->login(['device_id' => self::PHONE_A]);
        $this->app['auth']->forgetGuards();
        $b = $this->login(['device_id' => self::PHONE_B]);
        $this->app['auth']->forgetGuards();

        // Still signed in on phone B: they can still get offers there.
        $this->withToken($a)->postJson('/api/v1/auth/logout')->assertOk();
        $this->assertTrue($profile->fresh()->is_online);
        $this->app['auth']->forgetGuards();

        // Last sign-in gone: nothing can receive an offer, so stop matching.
        $this->withToken($b)->postJson('/api/v1/auth/logout')->assertOk();
        $this->assertFalse($profile->fresh()->is_online);
        $this->assertNull($profile->fresh()->online_since);
    }

    private function onlineRunnerProfile(): RunnerProfile
    {
        return RunnerProfile::create([
            'user_id' => $this->user->id, 'verification_status' => 'approved',
            'vehicle_type' => 'motorcycle', 'preferred_types' => ['delivery'],
            'is_online' => true, 'online_since' => now(),
        ]);
    }

    public function test_signing_out_ends_every_sign_in_of_this_phone_including_one_a_rotation_left(): void
    {
        $a = $this->login(['device_id' => self::PHONE_A, 'device_name' => 'Pixel 8']);
        $this->app['auth']->forgetGuards();
        // The sliding session rotated phone A's token: the new one has the same
        // name, and the old one stays alive for in-flight requests.
        $rotated = $this->user->createToken('device:'.self::PHONE_A.'|Pixel 8')->plainTextToken;
        $b = $this->login(['device_id' => self::PHONE_B]);
        $this->app['auth']->forgetGuards();

        $this->withToken($rotated)->postJson('/api/v1/auth/logout')->assertOk();
        $this->app['auth']->forgetGuards();

        $this->assertSame(['device:'.self::PHONE_B], $this->tokenNames());
        $this->withToken($a)->getJson('/api/v1/user/profile')->assertStatus(401);
        $this->app['auth']->forgetGuards();
        $this->withToken($b)->getJson('/api/v1/user/profile')->assertOk();
    }

    public function test_a_runner_signing_out_goes_offline_even_when_a_rotation_left_a_token_on_this_phone(): void
    {
        $profile = $this->onlineRunnerProfile();
        $old = $this->login(['device_id' => self::PHONE_A]);
        $this->app['auth']->forgetGuards();
        $this->user->createToken('device:'.self::PHONE_A); // the rotated-in token

        $this->withToken($old)->postJson('/api/v1/auth/logout')->assertOk();

        $this->assertSame([], $this->tokenNames());
        $this->assertFalse($profile->fresh()->is_online);
    }

    public function test_a_phone_signed_in_without_a_device_id_signs_out_its_rotated_token_too(): void
    {
        $profile = $this->onlineRunnerProfile();
        $old = $this->login(['device_name' => 'Old Android']);
        $this->app['auth']->forgetGuards();
        $this->user->createToken('Old Android'); // same name: the rotation's replacement

        $this->withToken($old)->postJson('/api/v1/auth/logout')->assertOk();

        $this->assertSame([], $this->tokenNames());
        $this->assertFalse($profile->fresh()->is_online);
    }

    public function test_an_expired_sign_in_on_another_phone_does_not_keep_a_runner_online(): void
    {
        $profile = $this->onlineRunnerProfile();
        $a = $this->login(['device_id' => self::PHONE_A]);
        $this->app['auth']->forgetGuards();

        // Phone B's sign-in is past Sanctum's lifetime; phone C's past its own expiry.
        $lifetime = (int) config('sanctum.expiration');
        $stale = $this->user->createToken('device:'.self::PHONE_B)->accessToken;
        $stale->forceFill(['created_at' => now()->subMinutes($lifetime + 60)])->save();
        $this->user->createToken('device:6f1c2b8e-3333-4a5b-9c0d-cccccccccccc', ['*'], now()->subMinute());

        $this->withToken($a)->postJson('/api/v1/auth/logout')->assertOk();

        $this->assertFalse($profile->fresh()->is_online);
    }

    public function test_signing_out_of_all_devices_takes_a_runner_offline(): void
    {
        $profile = RunnerProfile::create([
            'user_id' => $this->user->id, 'verification_status' => 'approved',
            'vehicle_type' => 'motorcycle', 'preferred_types' => ['delivery'],
            'is_online' => true, 'online_since' => now(),
        ]);

        $a = $this->login(['device_id' => self::PHONE_A]);
        $this->app['auth']->forgetGuards();
        $this->login(['device_id' => self::PHONE_B]);
        $this->app['auth']->forgetGuards();

        $this->withToken($a)->postJson('/api/v1/auth/logout-all')->assertOk();

        $this->assertFalse($profile->fresh()->is_online);
    }

    public function test_logout_with_a_push_token_drops_that_registration_only(): void
    {
        $a = $this->login(['device_id' => self::PHONE_A]);
        $b = $this->login(['device_id' => self::PHONE_B]);
        $this->registerPush($a, 'ExponentPushToken[phone-a]');
        $this->registerPush($b, 'ExponentPushToken[phone-b]');

        $this->withToken($a)->postJson('/api/v1/auth/logout', ['device_token' => 'ExponentPushToken[phone-a]'])->assertOk();

        $this->assertSame(['ExponentPushToken[phone-b]'], DeviceToken::where('user_id', $this->user->id)->pluck('token')->all());
        $this->assertSame(1, $this->user->tokens()->count());
    }

    public function test_logout_without_a_push_token_drops_the_registration_from_this_sign_in(): void
    {
        $a = $this->login(['device_id' => self::PHONE_A]);
        $b = $this->login(['device_id' => self::PHONE_B]);
        $this->registerPush($a, 'ExponentPushToken[phone-a]');
        $this->registerPush($b, 'ExponentPushToken[phone-b]');
        $this->assertSame(self::PHONE_A, DeviceToken::where('token', 'ExponentPushToken[phone-a]')->value('device_id'));

        $this->withToken($a)->postJson('/api/v1/auth/logout')->assertOk();

        $this->assertSame(['ExponentPushToken[phone-b]'], DeviceToken::where('user_id', $this->user->id)->pluck('token')->all());
    }

    public function test_logout_clears_the_legacy_push_column_when_it_points_at_this_phone(): void
    {
        $a = $this->login(['device_id' => self::PHONE_A]);
        $this->registerPush($a, 'ExponentPushToken[phone-a]');
        $this->assertSame('ExponentPushToken[phone-a]', $this->user->fresh()->fcm_token);

        $this->withToken($a)->postJson('/api/v1/auth/logout')->assertOk();

        $this->assertNull($this->user->fresh()->fcm_token);
    }

    public function test_logout_never_drops_another_accounts_registration(): void
    {
        $other = User::factory()->create();
        DeviceToken::create(['user_id' => $other->id, 'token' => 'ExponentPushToken[theirs]']);
        $a = $this->login(['device_id' => self::PHONE_A]);

        $this->withToken($a)->postJson('/api/v1/auth/logout', ['device_token' => 'ExponentPushToken[theirs]'])->assertOk();

        $this->assertDatabaseHas('device_tokens', ['token' => 'ExponentPushToken[theirs]', 'user_id' => $other->id]);
    }

    public function test_logout_all_signs_out_every_device_and_drops_every_registration(): void
    {
        $a = $this->login(['device_id' => self::PHONE_A]);
        $b = $this->login(['device_id' => self::PHONE_B]);
        $this->registerPush($a, 'ExponentPushToken[phone-a]');
        $this->registerPush($b, 'ExponentPushToken[phone-b]');

        $this->withToken($a)->postJson('/api/v1/auth/logout-all')->assertOk();

        $this->assertSame(0, $this->user->tokens()->count());
        $this->assertSame(0, DeviceToken::where('user_id', $this->user->id)->count());
        $this->assertNull($this->user->fresh()->fcm_token);
    }

    public function test_logout_all_requires_sign_in(): void
    {
        $this->postJson('/api/v1/auth/logout-all')->assertStatus(401);
    }

    // ── Change password ───────────────────────────────────────────────

    private function changePassword(string $bearer, array $body): \Illuminate\Testing\TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($bearer)->putJson('/api/v1/user/password', $body);
    }

    public function test_changing_the_password_keeps_this_phone_and_signs_the_others_out(): void
    {
        $a = $this->login(['device_id' => self::PHONE_A]);
        $b = $this->login(['device_id' => self::PHONE_B]);
        $this->registerPush($a, 'ExponentPushToken[phone-a]');
        $this->registerPush($b, 'ExponentPushToken[phone-b]');

        $this->changePassword($a, [
            'current_password' => 'Password1!',
            'password' => 'NewPass1!x',
            'password_confirmation' => 'NewPass1!x',
        ])->assertOk();

        $this->assertTrue(Hash::check('NewPass1!x', $this->user->fresh()->password_hash));
        $this->app['auth']->forgetGuards();
        $this->withToken($a)->getJson('/api/v1/user/profile')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($b)->getJson('/api/v1/user/profile')->assertStatus(401);
        $this->assertSame(['ExponentPushToken[phone-a]'], DeviceToken::where('user_id', $this->user->id)->pluck('token')->all());
    }

    public function test_the_sent_push_token_is_kept_for_a_sign_in_without_a_device_id(): void
    {
        $a = $this->login(['device_name' => 'Old build']);
        $b = $this->login(['device_id' => self::PHONE_B]);
        $this->registerPush($a, 'ExponentPushToken[phone-a]');
        $this->registerPush($b, 'ExponentPushToken[phone-b]');

        $this->changePassword($a, [
            'current_password' => 'Password1!',
            'password' => 'NewPass1!x',
            'password_confirmation' => 'NewPass1!x',
            'device_token' => 'ExponentPushToken[phone-a]',
        ])->assertOk();

        $this->assertSame(['ExponentPushToken[phone-a]'], DeviceToken::where('user_id', $this->user->id)->pluck('token')->all());
    }

    public function test_a_wrong_current_password_changes_nothing(): void
    {
        $a = $this->login(['device_id' => self::PHONE_A]);
        $this->login(['device_id' => self::PHONE_B]);

        $this->changePassword($a, [
            'current_password' => 'Wrong1!pass',
            'password' => 'NewPass1!x',
            'password_confirmation' => 'NewPass1!x',
        ])->assertStatus(422)->assertJsonValidationErrors(['current_password']);

        $this->assertTrue(Hash::check('Password1!', $this->user->fresh()->password_hash));
        $this->assertSame(2, $this->user->tokens()->count());
    }

    public function test_the_new_password_must_be_strong_and_different(): void
    {
        $a = $this->login();

        $this->changePassword($a, ['current_password' => 'Password1!', 'password' => 'weak', 'password_confirmation' => 'weak'])
            ->assertStatus(422)->assertJsonValidationErrors(['password']);
        $this->changePassword($a, ['current_password' => 'Password1!', 'password' => 'Password1!', 'password_confirmation' => 'Password1!'])
            ->assertStatus(422)->assertJsonValidationErrors(['password']);
    }

    public function test_current_password_guesses_are_throttled(): void
    {
        $a = $this->login();
        $body = ['current_password' => 'Wrong1!pass', 'password' => 'NewPass1!x', 'password_confirmation' => 'NewPass1!x'];

        for ($i = 0; $i < 5; $i++) {
            $this->changePassword($a, $body)->assertStatus(422);
        }

        $this->changePassword($a, $body)->assertStatus(429);
    }

    // ── Suspension ────────────────────────────────────────────────────

    public function test_suspension_drops_every_push_registration(): void
    {
        $a = $this->login(['device_id' => self::PHONE_A]);
        $this->registerPush($a, 'ExponentPushToken[phone-a]');
        DeviceToken::create(['user_id' => $this->user->id, 'token' => 'ExponentPushToken[tablet]']);

        app(UserModerationService::class)->suspend($this->user->fresh(), 'Fraud report');

        $this->assertSame(0, $this->user->tokens()->count());
        $this->assertSame(0, DeviceToken::where('user_id', $this->user->id)->count());
        $this->assertNull($this->user->fresh()->fcm_token);
    }

    public function test_password_reset_codes_and_sign_in_codes_never_mix(): void
    {
        $otp = app(OTPService::class);
        $otp->storeOTP('devices@example.com', '654321', OTPService::PASSWORD_RESET);

        // A reset code can't be used to sign in.
        $this->postJson('/api/v1/auth/verify-otp', ['email' => 'devices@example.com', 'code' => '654321'])
            ->assertStatus(422);
        $this->assertSame(0, $this->user->tokens()->count());
    }
}
