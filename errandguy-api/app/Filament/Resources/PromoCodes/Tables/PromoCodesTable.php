<?php

namespace App\Filament\Resources\PromoCodes\Tables;

use App\Filament\Support\ExportCsv;
use App\Models\AdminUser;
use App\Models\PromoCode;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class PromoCodesTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('code')
                    ->searchable(),
                TextColumn::make('discount_type')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        'percentage' => 'info',
                        'fixed' => 'success',
                        default => 'gray',
                    }),
                TextColumn::make('discount_value')
                    ->sortable(),
                TextColumn::make('used_count')
                    ->sortable(),
                TextColumn::make('usage_limit')
                    ->placeholder('∞'),
                TextColumn::make('valid_until')
                    ->dateTime()
                    ->sortable(),
                IconColumn::make('is_active')
                    ->boolean()
                    ->sortable(),
            ])
            ->filters([
                TernaryFilter::make('is_active')->label('Active'),
            ])
            ->headerActions([
                ExportCsv::make('promo-codes', [
                    'Code' => fn (PromoCode $r): ?string => $r->code,
                    'Discount type' => fn (PromoCode $r): ?string => $r->discount_type,
                    'Value' => fn (PromoCode $r) => $r->discount_value,
                    'Used' => fn (PromoCode $r) => $r->used_count,
                    'Usage limit' => fn (PromoCode $r) => $r->usage_limit,
                    'Active' => fn (PromoCode $r): bool => (bool) $r->is_active,
                    'Valid until' => fn (PromoCode $r) => $r->valid_until,
                ]),
            ])
            ->recordActions([
                EditAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    // Promo mutation is super_admin/admin only (canMutate); finance
                    // may only VIEW. But a LIST bulk-delete is authorized via the
                    // 'deleteAny' policy path, which falls through the AdminUser
                    // Gate::before to ALLOW for every admin role — letting finance
                    // bulk-delete promo codes past the mutate gate. Gate it. (audit v5 authz)
                    DeleteBulkAction::make()
                        ->visible(fn (): bool => auth('admin')->user()?->hasAnyRole(
                            AdminUser::ROLE_SUPER_ADMIN,
                            AdminUser::ROLE_ADMIN,
                        ) ?? false),
                ]),
            ]);
    }
}
