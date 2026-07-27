<?php

namespace App\Filament\Resources\Reviews\Tables;

use App\Models\AdminUser;
use App\Support\AdminActivity;
use Filament\Actions\Action;
use Filament\Actions\DeleteAction;
use Filament\Actions\ViewAction;
use Filament\Notifications\Notification;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class ReviewsTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('rating')
                    ->sortable()
                    ->formatStateUsing(fn (int $state): string => str_repeat('★', $state).str_repeat('☆', 5 - $state))
                    ->color('warning'),
                TextColumn::make('reviewer.full_name')->label('Reviewer')->searchable(),
                TextColumn::make('reviewee.full_name')->label('Reviewee')->searchable(),
                TextColumn::make('comment')->limit(40)->wrap()->placeholder('—'),
                IconColumn::make('is_flagged')->boolean(),
                TextColumn::make('booking.booking_number')->label('Booking')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('created_at')->dateTime()->since(),
            ])
            ->filters([
                TernaryFilter::make('is_flagged'),
            ])
            ->recordActions([
                ViewAction::make(),

                Action::make('toggleFlag')
                    ->label(fn ($record): string => $record->is_flagged ? 'Unflag' : 'Flag')
                    ->icon(Heroicon::OutlinedExclamationTriangle)
                    ->color(fn ($record): string => $record->is_flagged ? 'gray' : 'warning')
                    ->requiresConfirmation()
                    ->action(function ($record): void {
                        $record->update(['is_flagged' => ! $record->is_flagged]);

                        AdminActivity::log(
                            $record->is_flagged ? 'review.flagged' : 'review.unflagged',
                            $record,
                        );

                        Notification::make()
                            ->title($record->is_flagged ? 'Review flagged' : 'Review unflagged')
                            ->success()
                            ->send();
                    }),

                DeleteAction::make()
                    ->visible(fn (): bool => auth('admin')->user()?->hasAnyRole(
                        AdminUser::ROLE_SUPER_ADMIN,
                        AdminUser::ROLE_ADMIN,
                    ) ?? false)
                    ->after(fn ($record): mixed => AdminActivity::log('review.deleted', $record)),
            ]);
    }
}
