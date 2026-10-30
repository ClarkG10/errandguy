<?php

namespace App\Filament\Resources\Staff;

use App\Filament\Resources\Staff\Pages\ListStaff;
use App\Filament\Resources\Staff\Tables\StaffTable;
use App\Models\AdminUser;
use BackedEnum;
use Filament\Resources\Resource;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;

/**
 * Staff accounts — super admin only: add staff (they get a set-password
 * email), change roles, disable/enable, resend the set-password email, reset
 * a lost two-step sign-in, and lift a sign-in lock. Every change goes through
 * StaffAccountService and is audited.
 *
 * Every ability is spelled out here: the AdminUser Gate::before allows
 * everything, so a missing can*() would open it to every staff role.
 */
class StaffResource extends Resource
{
    protected static ?string $model = AdminUser::class;

    protected static ?string $slug = 'staff';

    protected static ?string $modelLabel = 'staff member';

    protected static ?string $pluralModelLabel = 'staff';

    protected static ?string $navigationLabel = 'Staff';

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedIdentification;

    protected static string|\UnitEnum|null $navigationGroup = 'System';

    protected static ?int $navigationSort = 5;

    public static function table(Table $table): Table
    {
        return StaffTable::configure($table);
    }

    public static function getPages(): array
    {
        return [
            'index' => ListStaff::route('/'),
        ];
    }

    public static function canManageStaff(): bool
    {
        return auth('admin')->user()?->isSuperAdmin() ?? false;
    }

    public static function canViewAny(): bool
    {
        return static::canManageStaff();
    }

    public static function canView(Model $record): bool
    {
        return static::canManageStaff();
    }

    // Added through the "Add staff member" action (StaffAccountService), never
    // a raw create / edit / delete form.
    public static function canCreate(): bool
    {
        return false;
    }

    public static function canEdit(Model $record): bool
    {
        return false;
    }

    public static function canDelete(Model $record): bool
    {
        return false;
    }

    public static function canDeleteAny(): bool
    {
        return false;
    }
}
