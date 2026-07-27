<?php

namespace App\Filament\Pages;

use App\Jobs\SendPushJob;
use App\Models\AdminUser;
use App\Models\User;
use App\Services\NotificationService;
use App\Support\AdminActivity;
use BackedEnum;
use Filament\Actions\Action;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Support\Icons\Heroicon;

/**
 * Compose and send a push notification to a segment of users. Audience-wide
 * sends are queued (SendPushJob) in id-chunks so the request never blocks on
 * Expo/FCM latency; a single-user send and a topic send are also supported.
 */
class PushBroadcast extends Page
{
    protected string $view = 'filament.pages.push-broadcast';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedMegaphone;

    protected static string|\UnitEnum|null $navigationGroup = 'System';

    protected static ?int $navigationSort = 30;

    protected static ?string $title = 'Push broadcast';

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
                ->schema([
                    Select::make('audience')
                        ->required()
                        ->live()
                        ->default('customers')
                        ->options([
                            'all' => 'Everyone',
                            'customers' => 'All customers',
                            'runners' => 'All runners',
                            'user' => 'A specific user (by ID)',
                            'topic' => 'An FCM topic',
                        ]),
                    TextInput::make('user_id')
                        ->label('User ID')
                        ->visible(fn (callable $get): bool => $get('audience') === 'user')
                        ->required(fn (callable $get): bool => $get('audience') === 'user'),
                    TextInput::make('topic')
                        ->visible(fn (callable $get): bool => $get('audience') === 'topic')
                        ->required(fn (callable $get): bool => $get('audience') === 'topic'),
                    TextInput::make('title')->required()->maxLength(120),
                    Textarea::make('body')->required()->maxLength(500),
                ])
                ->action(fn (array $data) => $this->dispatchBroadcast($data)),
        ];
    }

    protected function dispatchBroadcast(array $data): void
    {
        $title = $data['title'];
        $body = $data['body'];
        $payload = ['type' => 'broadcast'];
        $adminId = auth('admin')->id();

        if ($data['audience'] === 'topic') {
            app(NotificationService::class)->sendToTopic($data['topic'], $title, $body, $payload);
            AdminActivity::log('push.broadcast', null, ['audience' => 'topic', 'topic' => $data['topic']]);
            Notification::make()->title('Broadcast sent to topic')->success()->send();

            return;
        }

        if ($data['audience'] === 'user') {
            SendPushJob::dispatch($data['user_id'], $title, $body, $payload);
            AdminActivity::log('push.broadcast', null, ['audience' => 'user', 'user_id' => $data['user_id']]);
            Notification::make()->title('Push queued for user')->success()->send();

            return;
        }

        $query = User::query();
        if ($data['audience'] === 'customers') {
            $query->where('role', 'customer');
        } elseif ($data['audience'] === 'runners') {
            $query->where('role', 'runner');
        }
        // 'all' => no role filter.

        $count = 0;
        $query->select('id')->chunkById(500, function ($users) use ($title, $body, $payload, &$count): void {
            foreach ($users as $user) {
                SendPushJob::dispatch($user->id, $title, $body, $payload);
                $count++;
            }
        });

        AdminActivity::log('push.broadcast', null, ['audience' => $data['audience'], 'recipients' => $count]);
        Notification::make()->title("Broadcast queued for {$count} users")->success()->send();
    }
}
