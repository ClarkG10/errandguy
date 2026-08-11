<?php

namespace App\Filament\Resources\ErrandTypes\Tables;

use App\Models\AdminUser;
use Filament\Actions\BulkActionGroup;
use Filament\Actions\DeleteBulkAction;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class ErrandTypesTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('sort_order')
            ->columns([
                TextColumn::make('sort_order')->label('#')->sortable(),
                TextColumn::make('name')->searchable()->sortable(),
                TextColumn::make('slug')->searchable()->toggleable()->color('gray'),
                TextColumn::make('base_fee')->money('PHP')->sortable(),
                TextColumn::make('surcharge')->money('PHP')->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('min_negotiate_fee')->label('Min negotiate')->money('PHP')
                    ->toggleable(isToggledHiddenByDefault: true),
                IconColumn::make('is_active')->boolean()->sortable(),
                TextColumn::make('created_at')->dateTime()->since()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                TernaryFilter::make('is_active')->label('Active'),
            ])
            ->recordActions([
                EditAction::make(),
            ])
            ->toolbarActions([
                BulkActionGroup::make([
                    // Catalog mutation is super_admin/admin only (canManageCatalog).
                    // Filament authorizes a LIST bulk-delete via the 'deleteAny'
                    // policy path, which — with no ErrandTypePolicy — falls through
                    // the AdminUser Gate::before to ALLOW for EVERY admin role,
                    // bypassing the resource's canDelete() override. Gate it
                    // explicitly so support/ops/finance can't wipe the pricing
                    // catalog. (audit v5 authz)
                    DeleteBulkAction::make()
                        ->visible(fn (): bool => auth('admin')->user()?->hasAnyRole(
                            AdminUser::ROLE_SUPER_ADMIN,
                            AdminUser::ROLE_ADMIN,
                        ) ?? false),
                ]),
            ]);
    }
}
