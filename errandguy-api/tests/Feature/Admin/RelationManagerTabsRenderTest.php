<?php

namespace Tests\Feature\Admin;

use App\Filament\Resources\RunnerProfiles\Pages\ViewRunnerProfile;
use App\Filament\Resources\RunnerProfiles\RelationManagers\RunnerDocumentsRelationManager;
use App\Filament\Resources\RunnerProfiles\RelationManagers\RunnerErrandsRelationManager;
use App\Filament\Resources\Users\Pages\ViewUser;
use App\Filament\Resources\Users\RelationManagers\CustomerBookingsRelationManager;
use App\Filament\Resources\Users\RelationManagers\ReviewsRelationManager;
use App\Filament\Resources\Users\RelationManagers\RunnerBookingsRelationManager;
use App\Filament\Resources\Users\RelationManagers\WalletTransactionsRelationManager;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Review;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Livewire\Livewire;
use Tests\TestCase;

/**
 * The tabs under a person's and a runner's page render WITH rows. Their status
 * badges used `->color(fn (string $s) => …)`: Filament fills closure
 * parameters by name, so `$s` was unresolvable and every tab with a row —
 * including the runner's Documents tab, where ID and selfie are approved —
 * crashed with a server error. No test rendered them with rows.
 */
class RelationManagerTabsRenderTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    private User $runner;

    private RunnerProfile $profile;

    protected function setUp(): void
    {
        parent::setUp();

        $this->actingAs(AdminUser::create([
            'email' => 'boss@errandguy.test', 'password_hash' => Hash::make('Password1!'),
            'full_name' => 'Boss', 'role' => 'super_admin', 'is_active' => true,
        ]), 'admin');

        $this->customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $this->runner = User::factory()->create(['role' => 'runner', 'status' => 'active']);
        $this->profile = RunnerProfile::create(['user_id' => $this->runner->id, 'verification_status' => 'pending', 'preferred_types' => []]);

        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'Deliver', 'icon_name' => 'Package',
            'base_fee' => 50.00, 'per_km_walk' => 15.00, 'per_km_bicycle' => 12.00, 'per_km_motorcycle' => 10.00,
            'per_km_car' => 18.00, 'is_active' => true, 'sort_order' => 1,
        ]);

        foreach (['completed', 'cancelled', 'in_transit'] as $i => $status) {
            $booking = Booking::create([
                'booking_number' => 'EG-TABS-'.$i, 'customer_id' => $this->customer->id, 'runner_id' => $this->runner->id,
                'errand_type_id' => $type->id, 'status' => $status, 'payment_status' => 'paid', 'accepted_at' => now(),
                'pickup_address' => '123 Main', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
                'dropoff_address' => '456 Oak', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
                'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
                'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
                'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 100, 'is_transportation' => false,
            ]);
        }
        Review::create(['booking_id' => $booking->id, 'reviewer_id' => $this->customer->id, 'reviewee_id' => $this->runner->id, 'rating' => 5]);

        WalletTransaction::create(['user_id' => $this->runner->id, 'type' => 'earning', 'amount' => 100, 'balance_after' => 100, 'status' => 'completed', 'description' => 'Earnings']);
        WalletTransaction::create(['user_id' => $this->runner->id, 'type' => 'payout', 'amount' => -100, 'balance_after' => 0, 'status' => 'pending', 'description' => 'Payout request']);

        foreach (['government_id' => 'approved', 'selfie' => 'pending', 'drivers_license' => 'rejected'] as $doc => $status) {
            RunnerDocument::create(['runner_id' => $this->profile->id, 'document_type' => $doc, 'file_path' => "kyc/{$doc}.jpg", 'status' => $status]);
        }
    }

    public function test_a_person_page_tabs_render_their_rows(): void
    {
        foreach ([
            [CustomerBookingsRelationManager::class, $this->customer, 3],
            [RunnerBookingsRelationManager::class, $this->runner, 3],
            [WalletTransactionsRelationManager::class, $this->runner, 2],
            [ReviewsRelationManager::class, $this->runner, 1],
        ] as [$manager, $owner, $rows]) {
            Livewire::test($manager, ['ownerRecord' => $owner, 'pageClass' => ViewUser::class])
                ->assertOk()
                ->assertCountTableRecords($rows);
        }
    }

    public function test_a_runner_page_tabs_render_their_rows(): void
    {
        Livewire::test(RunnerErrandsRelationManager::class, ['ownerRecord' => $this->profile, 'pageClass' => ViewRunnerProfile::class])
            ->assertOk()
            ->assertCountTableRecords(3);

        Livewire::test(RunnerDocumentsRelationManager::class, ['ownerRecord' => $this->profile, 'pageClass' => ViewRunnerProfile::class])
            ->assertOk()
            ->assertCountTableRecords(3)
            ->assertSee('pending');
    }

    /**
     * Guard: a closure handed to a panel component may only take a value
     * parameter by a name Filament fills ($state, $record, …) — a typed model
     * is fine (filled by type), a scalar under another name is not.
     */
    public function test_panel_closures_only_take_parameters_filament_can_fill(): void
    {
        $fillable = 'state|record|records|query|data|livewire|get|set|search|component|operation|rawState|table|column|action|arguments|model|schema|value|old|replica|ownerRecord|selectedRecords|context|user|filter|fail|attribute|label';
        $pattern = '/->\w+\(\s*(?:static\s+)?(?:fn|function)\s*\(\s*(?:\??(?:string|int|float|bool|array|mixed)\s+)?\$(?!(?:'.$fillable.')\b)(\w+)/';
        $skip = '/->(map|filter|each|reject|sortBy|sortByDesc|first|where|whereHas|orWhereHas|whereDoesntHave|mapWithKeys|sum|groupBy|keyBy|transform|every|contains|flatMap|when|unless|tap|orWhere|partition|afterCommit|transaction)\(/';

        $offenders = [];
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path('Filament')));
        foreach ($files as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            foreach (file($file->getPathname()) as $n => $line) {
                if (preg_match($pattern, $line, $m) && ! preg_match($skip, $line)) {
                    $offenders[] = str_replace(app_path(), 'app', $file->getPathname()).':'.($n + 1).' $'.$m[1];
                }
            }
        }

        $this->assertSame([], $offenders, 'Filament cannot fill these closure parameters by name.');
    }
}
