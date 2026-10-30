<?php

namespace Tests\Feature\Admin;

use App\Filament\Pages\PushBroadcast;
use App\Jobs\SendPushJob;
use App\Models\AdminUser;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * A push broadcast says how many people it will reach before anything is
 * sent, and no longer offers an FCM "topic" audience (no device subscribes to
 * one, so it reached nobody).
 */
class PushBroadcastConfirmTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $admin = AdminUser::forceCreate([
            'email' => 'super@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Super', 'role' => 'super_admin', 'is_active' => true,
            'has_email_authentication' => true, // two-step sign-in set up
        ]);
        $this->actingAs($admin, 'admin');
    }

    public function test_the_topic_audience_is_gone(): void
    {
        $this->assertArrayNotHasKey('topic', PushBroadcast::AUDIENCES);
        $this->assertSame(['all', 'customers', 'runners', 'user'], array_keys(PushBroadcast::AUDIENCES));
    }

    public function test_the_confirmation_states_the_audience_size(): void
    {
        User::factory()->count(3)->create(['role' => 'customer', 'status' => 'active']);
        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);

        $this->assertSame('This will go to 3 people (all customers).', PushBroadcast::confirmationLine('customers'));
        $this->assertSame('This will go to 1 person (all runners).', PushBroadcast::confirmationLine('runners'));
        $this->assertSame('This will go to 4 people (everyone).', PushBroadcast::confirmationLine('all'));
        $this->assertSame('This will go to 1 person (that user).', PushBroadcast::confirmationLine('user', $runner->id));
        $this->assertStringContainsString('reach nobody', PushBroadcast::confirmationLine('user', '00000000-0000-0000-0000-000000000000'));
    }

    public function test_the_last_step_shows_the_audience_size_before_sending(): void
    {
        Bus::fake([SendPushJob::class]);
        User::factory()->count(2)->create(['role' => 'customer', 'status' => 'active']);

        Livewire::test(PushBroadcast::class)
            ->mountAction('send')
            ->fillForm(['audience' => 'customers', 'title' => 'Hello', 'body' => 'New in town'])
            ->goToNextWizardStep()
            ->assertHasNoFormErrors()
            ->assertMountedActionModalSee('This will go to 2 people (all customers).');

        Bus::assertNotDispatched(SendPushJob::class);
    }

    public function test_sending_queues_one_push_per_person_in_the_audience(): void
    {
        Bus::fake([SendPushJob::class]);
        User::factory()->count(2)->create(['role' => 'customer', 'status' => 'active']);
        User::factory()->create(['role' => 'runner', 'status' => 'active']);

        Livewire::test(PushBroadcast::class)
            ->callAction('send', ['audience' => 'customers', 'title' => 'Hello', 'body' => 'New in town'])
            ->assertHasNoActionErrors();

        Bus::assertDispatchedTimes(SendPushJob::class, 2);
    }

    public function test_the_page_renders(): void
    {
        $this->get('/admin/push-broadcast')->assertOk()->assertSee('New broadcast');
    }
}
