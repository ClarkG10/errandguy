<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Filament\Resources\Users\UserResource;
use App\Models\AdminUser;
use App\Models\RunnerProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Staff answering a call type the number the caller reads out — "0917 123
 * 4567" — while phones are stored as +639171234567. The top-bar search must
 * still find the account and the runner.
 */
class GlobalSearchPhoneTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_phone_typed_the_way_people_say_it_finds_the_account(): void
    {
        $this->actingAs(AdminUser::forceCreate([
            'email' => 'support@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Support', 'role' => 'support', 'is_active' => true,
        ]), 'admin');

        $runner = User::factory()->create(['role' => 'runner', 'status' => 'active', 'phone' => '+639171234567', 'full_name' => 'Rhea Runner']);
        User::factory()->create(['role' => 'customer', 'status' => 'active', 'phone' => '+639989876543']);
        $profile = RunnerProfile::create(['user_id' => $runner->id, 'verification_status' => 'approved']);

        foreach (['0917 123 4567', '09171234567', '63917-123-4567'] as $typed) {
            $this->assertSame([$runner->id], UserResource::getGlobalSearchResults($typed)->map->url
                ->map(fn ($url) => basename(dirname($url)))->values()->all(), $typed);
            $this->assertCount(1, RunnerProfileResource::getGlobalSearchResults($typed), $typed);
        }

        // Ordinary name search is unchanged.
        $this->assertCount(1, UserResource::getGlobalSearchResults('Rhea'));
    }
}
