<?php

namespace App\Filament\Pages;

use App\Filament\Support\AdminNotify;
use App\Jobs\SendPushJob;
use App\Models\AdminUser;
use App\Models\User;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Pages\Page;
use Filament\Schemas\Components\Text;
use Filament\Schemas\Components\Utilities\Get;
use Filament\Schemas\Components\Wizard\Step;
use Filament\Support\Icons\Heroicon;
use Illuminate\Database\Eloquent\Builder;

/**
 * Compose and send a push notification to a segment of users. Audience-wide
 * sends are queued (SendPushJob) in id-chunks so the request never blocks on
 * Expo/FCM latency; a single-user send is also supported. The last step shows
 * how many people the broadcast will reach before anything is sent.
 */
class PushBroadcast extends Page
{
    protected string $view = 'filament.pages.push-broadcast';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedMegaphone;

    protected static string|\UnitEnum|null $navigationGroup = 'System';

    protected static ?int $navigationSort = 30;

    protected static ?string $title = 'Push broadcast';

    /** Who a broadcast can go to. */
    public const AUDIENCES = [
        'all' => 'Everyone',
        'customers' => 'All customers',
        'runners' => 'All runners',
        'user' => 'A specific user (by ID)',
    ];

    public static function canAccess(): bool
    {
        return auth('admin')->user()?->hasAnyRole(AdminUser::ROLE_SUPER_ADMIN, AdminUser::ROLE_ADMIN) ?? false;
    }

    protected function getHeaderActions(): array
    {
        return [
            Action::make('send')
                ->label('New broadcast')
                ->icon(Heroicon::OutlinedPaperAirplane)
                ->modalSubmitActionLabel('Send broadcast')
                ->steps([
                    Step::make('Message')
                        ->schema([
                            Select::make('audience')
                                ->required()
                                ->live()
                                ->default('customers')
                                ->options(self::AUDIENCES),
                            TextInput::make('user_id')
                                ->label('User ID')
                                ->live(onBlur: true)
                                ->visible(fn (Get $get): bool => $get('audience') === 'user')
                                ->required(fn (Get $get): bool => $get('audience') === 'user'),
                            TextInput::make('title')->required()->maxLength(120),
                            Textarea::make('body')->required()->maxLength(500),
                        ]),
                    Step::make('Confirm')
                        ->schema([
                            Text::make(fn (Get $get): string => self::confirmationLine(
                                (string) $get('audience'),
                                $get('user_id'),
                            ))->weight('bold'),
                            Text::make(fn (Get $get): string => '“'.$get('title').'” — '.$get('body')),
                            Text::make('Nothing is sent until you press Send broadcast.'),
                        ]),
                ])
                ->action(fn (array $data) => $this->dispatchBroadcast($data)),
        ];
    }

    /** The people a broadcast to this audience reaches. */
    public static function audienceQuery(string $audience, ?string $userId = null): Builder
    {
        $query = User::query();

        return match ($audience) {
            'customers' => $query->where('role', 'customer'),
            'runners' => $query->where('role', 'runner'),
            'user' => $query->whereKey((string) $userId),
            default => $query,
        };
    }

    /** "This will go to 1,234 people (all customers)." — shown before sending. */
    public static function confirmationLine(string $audience, ?string $userId = null): string
    {
        if ($audience === 'user' && blank($userId)) {
            return 'Enter the user ID on the previous step.';
        }

        $count = self::audienceQuery($audience, $userId)->count();
        $label = $audience === 'user' ? 'that user' : mb_strtolower(self::AUDIENCES[$audience] ?? $audience);

        if ($count === 0) {
            return 'This will reach nobody ('.$label.') — go back and change the audience.';
        }

        return 'This will go to '.number_format($count).' '.($count === 1 ? 'person' : 'people')
            .' ('.$label.').';
    }

    protected function dispatchBroadcast(array $data): void
    {
        $title = $data['title'];
        $body = $data['body'];
        $payload = ['type' => 'broadcast'];

        if ($data['audience'] === 'user') {
            SendPushJob::dispatch($data['user_id'], $title, $body, $payload);
            AdminNotify::success(
                'Push queued for user',
                audit: 'push.broadcast',
                properties: ['audience' => 'user', 'user_id' => $data['user_id']],
                note: "Queued for user {$data['user_id']}.",
            );

            return;
        }

        $count = 0;
        self::audienceQuery($data['audience'])
            ->select('id')
            ->chunkById(500, function ($users) use ($title, $body, $payload, &$count): void {
                foreach ($users as $user) {
                    SendPushJob::dispatch($user->id, $title, $body, $payload);
                    $count++;
                }
            });

        AdminNotify::success(
            "Broadcast queued for {$count} users",
            audit: 'push.broadcast',
            properties: ['audience' => $data['audience'], 'recipients' => $count],
            note: "Targeting the {$data['audience']} segment.",
        );
    }
}
