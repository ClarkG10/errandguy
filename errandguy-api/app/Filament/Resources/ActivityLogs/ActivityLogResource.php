<?php

namespace App\Filament\Resources\ActivityLogs;

use App\Filament\Resources\ActivityLogs\Pages\ListActivityLogs;
use App\Filament\Resources\ActivityLogs\Pages\ViewActivityLog;
use App\Models\AdminUser;
use BackedEnum;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Resource;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Spatie\Activitylog\Models\Activity;

/**
 * Read-only audit trail — every admin action recorded via AdminActivity::log()
 * (suspensions, approvals, refunds, cancellations, SOS resolutions, exports,
 * setting and staff changes…) plus every staff sign-in and failed attempt.
 * Restricted to super-admin / admin.
 */
class ActivityLogResource extends Resource
{
    protected static ?string $model = Activity::class;

    protected static string|BackedEnum|null $navigationIcon = Heroicon::OutlinedClipboardDocumentCheck;

    protected static string|\UnitEnum|null $navigationGroup = 'System';

    protected static ?int $navigationSort = 90;

    protected static ?string $recordTitleAttribute = 'description';

    protected static ?string $modelLabel = 'audit log entry';

    protected static ?string $pluralModelLabel = 'audit log';

    /**
     * Only the causer is loaded. The subject is shown from subject_type and
     * subject_id alone, and loading it would fail the whole page on an entry
     * about a model class that has since been removed (DisputeTicket,
     * Referral, …).
     */
    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->with(['causer']);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('created_at')->label('When')->dateTime()->since()->dateTimeTooltip()->sortable(),
                TextColumn::make('event')->badge()->color(fn (?string $state): string => match (true) {
                    str_contains((string) $state, 'reject'), str_contains((string) $state, 'suspend'), str_contains((string) $state, 'cancel'), str_contains((string) $state, 'fail') => 'danger',
                    str_contains((string) $state, 'approve'), str_contains((string) $state, 'resolve'), str_contains((string) $state, 'complete') => 'success',
                    str_contains((string) $state, 'refund'), str_contains((string) $state, 'export') => 'info',
                    default => 'gray',
                })->placeholder('—'),
                TextColumn::make('description')->wrap()->limit(60),
                TextColumn::make('causer_label')->label('By')
                    ->state(fn (Activity $r): string => self::causerLabel($r))
                    ->icon('heroicon-m-user')->color('primary'),
                TextColumn::make('subject_label')->label('On')
                    ->state(fn (Activity $r): string => self::subjectLabel($r))
                    ->color('gray'),
                TextColumn::make('log_name')->label('Log')->badge()->color('gray')->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('log_name')->label('Log')->options(fn (): array => Activity::query()
                    ->distinct()->orderBy('log_name')->pluck('log_name', 'log_name')->filter()->all()),
                SelectFilter::make('event')->options(fn (): array => Activity::query()
                    ->distinct()->orderBy('event')->pluck('event', 'event')->filter()->all()),
                // "What did this staff member do?"
                SelectFilter::make('causer_id')->label('By staff')
                    ->options(fn (): array => AdminUser::query()->orderBy('full_name')->pluck('full_name', 'id')->all())
                    ->query(fn (\Illuminate\Database\Eloquent\Builder $query, array $data) => filled($data['value'] ?? null)
                        ? $query->where('causer_type', AdminUser::class)->where('causer_id', $data['value'])
                        : $query)
                    ->searchable(),
                \App\Filament\Support\DateRangeFilter::make('created_at', 'When'),
            ])
            ->recordActions([
                \Filament\Actions\ViewAction::make(),
            ]);
    }

    public static function infolist(Schema $schema): Schema
    {
        return $schema->components([
            Section::make()
                ->columns(3)
                ->schema([
                    TextEntry::make('event')->badge(),
                    TextEntry::make('log_name')->badge()->color('gray'),
                    TextEntry::make('created_at')->dateTime(),
                    TextEntry::make('description')->columnSpanFull(),
                    TextEntry::make('causer_label')->label('Performed by')
                        ->state(fn (Activity $r): string => self::causerLabel($r)),
                    TextEntry::make('subject_label')->label('Subject')
                        ->state(fn (Activity $r): string => self::subjectLabel($r, full: true))
                        ->columnSpan(2),
                ]),
            Section::make('Properties')
                ->schema([
                    TextEntry::make('properties')->hiddenLabel()
                        ->placeholder('No extra properties.')
                        ->formatStateUsing(fn ($state): string => filled($state)
                            ? json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
                            : '')
                        ->fontFamily(\Filament\Support\Enums\FontFamily::Mono)
                        ->columnSpanFull(),
                ]),
        ]);
    }

    /**
     * What it was done to, in the words staff use: "Errand EG-1023",
     * "Juan Cruz", "Setting matching_radius_km" — not a UUID prefix.
     */
    private static function subjectLabel(Activity $r, bool $full = false): string
    {
        if (! $r->subject_type) {
            return '—';
        }

        $kind = class_basename($r->subject_type);
        $ref = $kind.' #'.($full ? $r->subject_id : substr((string) $r->subject_id, 0, 8));

        // Entries about retired features (disputes, referrals) name a class
        // that no longer exists: loading their subject would fail the page.
        // Not eager-loaded for the same reason; a page is 10–25 rows.
        if (! class_exists($r->subject_type)) {
            return $ref;
        }

        $s = $r->subject;
        if ($s !== null && $full) {
            return self::subjectLabel($r).' ('.$kind.' '.$r->subject_id.')';
        }

        return match (true) {
            $s === null => $ref.' (deleted)',
            $s instanceof \App\Models\Booking => 'Errand '.($s->booking_number ?? substr((string) $s->id, 0, 8)),
            $s instanceof \App\Models\User, $s instanceof AdminUser => (string) ($s->full_name ?: $s->email ?: $kind),
            $s instanceof \App\Models\ErrandType => 'Errand type '.$s->name,
            $s instanceof \App\Models\SystemConfig => 'Setting '.$s->key,
            $s instanceof \App\Models\WalletTransaction => ucfirst(str_replace('_', ' ', (string) $s->type)).' ₱'.number_format(abs((float) $s->amount), 2),
            $s instanceof \App\Models\Payment => 'Payment ₱'.number_format((float) $s->amount, 2),
            default => $kind.' #'.substr((string) $r->subject_id, 0, 8),
        };
    }

    /** Who did it; a failed staff sign-in has no signed-in staff member behind it. */
    private static function causerLabel(Activity $r): string
    {
        return $r->causer?->full_name
            ?? ($r->causer_type ? class_basename($r->causer_type) : (str_starts_with((string) $r->event, 'auth.') ? 'Sign-in page' : 'system'));
    }

    public static function getPages(): array
    {
        return [
            'index' => ListActivityLogs::route('/'),
            'view' => ViewActivityLog::route('/{record}/view'),
        ];
    }

    public static function canViewAny(): bool
    {
        return auth('admin')->user()?->hasAnyRole(AdminUser::ROLE_SUPER_ADMIN, AdminUser::ROLE_ADMIN) ?? false;
    }

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
}
