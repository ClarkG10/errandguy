<?php

namespace Tests\Feature\Auth;

use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RegisterTest extends TestCase
{
    use RefreshDatabase;

    private array $validCustomerData;
    private array $validRunnerData;

    protected function setUp(): void
    {
        parent::setUp();

        $this->validCustomerData = [
            'full_name' => 'Juan Dela Cruz',
            'phone' => '+639171234567',
            'email' => 'juan@example.com',
            'password' => 'Password1!',
            'role' => 'customer',
        ];

        $this->validRunnerData = [
            'full_name' => 'Maria Santos',
            'phone' => '+639181234567',
            'email' => 'maria@example.com',
            'password' => 'Password1!',
            'role' => 'runner',
        ];
    }

    public function test_customer_can_register_successfully(): void
    {
        $response = $this->postJson('/api/v1/auth/register', $this->validCustomerData);

        $response->assertStatus(201)
            ->assertJsonStructure([
                'user' => ['id', 'full_name', 'email', 'phone', 'role'],
                'token',
            ])
            ->assertJsonPath('user.role', 'customer')
            ->assertJsonPath('user.full_name', 'Juan Dela Cruz');

        $this->assertDatabaseHas('users', [
            'email' => 'juan@example.com',
            'phone' => '+639171234567',
            'role' => 'customer',
            'status' => 'active',
        ]);
    }

    public function test_runner_can_register_successfully(): void
    {
        $response = $this->postJson('/api/v1/auth/register', $this->validRunnerData);

        $response->assertStatus(201)
            ->assertJsonPath('user.role', 'runner');

        $user = User::where('email', 'maria@example.com')->first();
        $this->assertNotNull($user);

        $this->assertDatabaseHas('runner_profiles', [
            'user_id' => $user->id,
            'verification_status' => 'pending',
        ]);
    }

    public function test_customer_registration_does_not_create_runner_profile(): void
    {
        $this->postJson('/api/v1/auth/register', $this->validCustomerData);

        $user = User::where('email', 'juan@example.com')->first();
        $this->assertNull(RunnerProfile::where('user_id', $user->id)->first());
    }

    public function test_registration_returns_sanctum_token(): void
    {
        $response = $this->postJson('/api/v1/auth/register', $this->validCustomerData);

        $response->assertStatus(201);
        $this->assertNotEmpty($response->json('token'));
    }

    public function test_registration_creates_welcome_notification(): void
    {
        $this->postJson('/api/v1/auth/register', $this->validCustomerData);

        $user = User::where('email', 'juan@example.com')->first();

        $this->assertDatabaseHas('notifications', [
            'user_id' => $user->id,
            'type' => 'system',
        ]);
    }

    public function test_registration_fails_without_required_fields(): void
    {
        $response = $this->postJson('/api/v1/auth/register', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['full_name', 'password', 'role']);
    }

    public function test_registration_fails_without_phone_or_email(): void
    {
        $data = $this->validCustomerData;
        unset($data['phone'], $data['email']);

        $response = $this->postJson('/api/v1/auth/register', $data);

        $response->assertStatus(422);
    }

    public function test_registration_succeeds_with_phone_only(): void
    {
        $data = $this->validCustomerData;
        unset($data['email']);

        $response = $this->postJson('/api/v1/auth/register', $data);

        $response->assertStatus(201);
    }

    public function test_registration_succeeds_with_email_only(): void
    {
        $data = $this->validCustomerData;
        unset($data['phone']);

        $response = $this->postJson('/api/v1/auth/register', $data);

        $response->assertStatus(201);
    }

    public function test_registration_fails_with_duplicate_email(): void
    {
        User::factory()->create(['email' => 'juan@example.com']);

        $response = $this->postJson('/api/v1/auth/register', $this->validCustomerData);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['email']);
    }

    public function test_registration_fails_with_duplicate_phone(): void
    {
        User::factory()->create(['phone' => '+639171234567']);

        $response = $this->postJson('/api/v1/auth/register', $this->validCustomerData);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['phone']);
    }

    public function test_registration_fails_with_weak_password(): void
    {
        $data = $this->validCustomerData;
        $data['password'] = 'weak';

        $response = $this->postJson('/api/v1/auth/register', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['password']);
    }

    public function test_registration_fails_with_invalid_role(): void
    {
        $data = $this->validCustomerData;
        $data['role'] = 'admin';

        $response = $this->postJson('/api/v1/auth/register', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['role']);
    }

    public function test_registration_fails_with_invalid_phone_format(): void
    {
        $data = $this->validCustomerData;
        $data['phone'] = '12345';

        $response = $this->postJson('/api/v1/auth/register', $data);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['phone']);
    }

    public function test_password_is_hashed_in_database(): void
    {
        $this->postJson('/api/v1/auth/register', $this->validCustomerData);

        $user = User::where('email', 'juan@example.com')->first();
        $this->assertNotEquals('Password1!', $user->password_hash);
        $this->assertTrue(\Hash::check('Password1!', $user->password_hash));
    }
}
