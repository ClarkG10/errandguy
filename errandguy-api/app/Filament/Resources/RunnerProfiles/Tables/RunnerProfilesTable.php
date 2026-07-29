<?php

namespace App\Filament\Resources\RunnerProfiles\Tables;

use App\Filament\Support\ExportCsv;
use App\Models\AdminUser;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\BulkAction;
use Filament\Actions\ViewAction;
use Illuminate\Support\Collection;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class RunnerProfilesTable
{
    protected static function canModerate(): bool
    {
        return auth('admin')->user()?->hasAnyRole(
            AdminUser::ROLE_SUPER_ADMIN,
            AdminUser::ROLE_ADMIN,
            AdminUser::ROLE_OPS,
        ) ?? false;
    }

    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('user.full_name')->label('Runner')->searchable()->sortable(),
                TextColumn::make('user.phone')->label('Phone')->searchable(),
                TextColumn::make('verification_status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'approved' => 'success',
                        'pending' => 'warning',
                        'rejected' => 'danger',
                        default => 'gray',
                    }),
                TextColumn::make('vehicle_type')->badge()->color('gray'),
                TextColumn::make('vehicle_plate'),
                IconColumn::make('is_online')->boolean(),
                TextColumn::make('total_errands')->sortable(),
                TextColumn::make('total_earnings')->money('PHP')->sortable(),
                TextColumn::make('created_at')->dateTime()->since()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('verification_status')->options([
                    'pending' => 'Pending',
                    'approved' => 'Approved',
                    'rejected' => 'Rejected',
                ]),
                TernaryFilter::make('is_online'),
            ])
            ->headerActions([
                ExportCsv::make('runners', [
                    'Runner' => fn (RunnerProfile $r): ?string => $r->user?->full_name,
                    'Phone' => fn (RunnerProfile $r): ?string => $r->user?->phone,
                    'Verification' => fn (RunnerProfile $r): ?string => $r->verification_status,
                    'Vehicle' => fn (RunnerProfile $r): ?string => $r->vehicle_type,
                    'Plate' => fn (RunnerProfile $r): ?string => $r->vehicle_plate,
                    'Online' => fn (RunnerProfile $r): bool => (bool) $r->is_online,
                    'Total errands' => fn (RunnerProfile $r) => $r->total_errands,
                    'Total earnings (PHP)' => fn (RunnerProfile $r) => $r->total_earnings,
                    'Joined' => fn (RunnerProfile $r) => $r->created_at,
                ]),
            ])
            ->toolbarActions([
                ExportCsv::bulk('runners', [
                    'Runner' => fn (RunnerProfile $r): ?string => $r->user?->full_name,
                    'Phone' => fn (RunnerProfile $r): ?string => $r->user?->phone,
                    'Verification' => fn (RunnerProfile $r): ?string => $r->verification_status,
                    'Vehicle' => fn (RunnerProfile $r): ?string => $r->vehicle_type,
                    'Total earnings (PHP)' => fn (RunnerProfile $r) => $r->total_earnings,
                ]),
                BulkAction::make('bulkApprove')
                    ->label('Approve selected')
                    ->icon(Heroicon::OutlinedShieldCheck)
                    ->color('success')
                    ->requiresConfirmation()
                    ->modalDescription('Approve every selected runner that is still pending, and notify them.')
                    ->visible(fn (): bool => static::canModerate())
                    ->deselectRecordsAfterCompletion()
                    ->action(function (Collection $records): void {
                        $approved = 0;
                        foreach ($records as $record) {
                            if ($record->verification_status === 'approved') {
                                continue;
                            }
                            $record->update(['verification_status' => 'approved', 'approved_at' => now()]);
                            RunnerDocument::where('runner_id', $record->id)->where('status', 'pending')->update([
                                'status' => 'approved',
                                'reviewed_by' => auth('admin')->id(),
                                'reviewed_at' => now(),
                            ]);
                            \App\Jobs\SendPushJob::dispatch($record->user_id, 'Verification Approved!', 'You can now start accepting errands.');
                            AdminActivity::log('runner.approved', $record, ['via' => 'bulk']);
                            $approved++;
                        }
                        \Filament\Notifications\Notification::make()
                            ->title($approved.' runner'.($approved === 1 ? '' : 's').' approved')
                            ->success()->send();
                    }),
            ])
            ->recordActions([
                ViewAction::make(),

                Action::make('approve')
                    ->label('Approve runner')
                    ->icon(Heroicon::OutlinedShieldCheck)
                    ->color('success')
                    ->requiresConfirmation()
                    ->visible(fn ($record): bool => $record->verification_status !== 'approved'
                        && static::canModerate())
                    ->action(function ($record): void {
                        $record->update([
                            'verification_status' => 'approved',
                            'approved_at' => now(),
                        ]);

                        RunnerDocument::where('runner_id', $record->id)
                            ->where('status', 'pending')
                            ->update([
                                'status' => 'approved',
                                'reviewed_by' => auth('admin')->id(),
                                'reviewed_at' => now(),
                            ]);

                        \App\Jobs\SendPushJob::dispatch(
                            $record->user_id,
                            'Verification Approved!',
                            'You can now start accepting errands.',
                        );

                        AdminActivity::log('runner.approved', $record);

                        Notification::make()->title('Runner approved')->success()->send();
                    }),

                Action::make('reject')
                    ->label('Reject runner')
                    ->icon(Heroicon::OutlinedShieldExclamation)
                    ->color('danger')
                    ->schema([
                        Textarea::make('reason')->required()->maxLength(500),
                    ])
                    ->visible(fn ($record): bool => $record->verification_status !== 'rejected'
                        && static::canModerate())
                    ->action(function (array $data, $record): void {
                        $record->update([
                            'verification_status' => 'rejected',
                        ]);

                        RunnerDocument::where('runner_id', $record->id)
                            ->where('status', 'pending')
                            ->update([
                                'status' => 'rejected',
                                'rejection_reason' => $data['reason'],
                                'reviewed_by' => auth('admin')->id(),
                                'reviewed_at' => now(),
                            ]);

                        \App\Jobs\SendPushJob::dispatch(
                            $record->user_id,
                            'Verification Update',
                            $data['reason'],
                        );

                        AdminActivity::log('runner.rejected', $record, ['reason' => $data['reason']]);

                        Notification::make()->title('Runner rejected')->success()->send();
                    }),
            ]);
    }
}
