<?php

namespace App\Filament\Resources\RunnerProfiles\Tables;

use App\Filament\Support\AdminNotify;
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

    protected static function canSeeMoney(): bool
    {
        return auth('admin')->user()?->canManageMoney() ?? false;
    }

    /** The lifetime-earnings export column, for money roles only. */
    private static function earningsColumn(): array
    {
        return self::canSeeMoney()
            ? ['Total earnings (PHP)' => fn (RunnerProfile $r) => $r->total_earnings]
            : [];
    }

    /**
     * Government ID and selfie both approved — the only state in which a
     * runner may be approved. Reads the list query's aggregate when present,
     * so the button costs no query per row.
     */
    public static function documentsApproved(RunnerProfile $record): bool
    {
        $count = $record->getAttribute('approved_required_documents_count');

        return $count !== null
            ? (int) $count >= count(RunnerProfile::REQUIRED_DOCUMENT_TYPES)
            : $record->hasApprovedRequiredDocuments();
    }

    /**
     * The approval push. "You can now start accepting errands" was untrue for
     * a runner with no vehicle on file: going online is refused until one is
     * saved, so their first shift began with a detour. Say what is left to do.
     */
    public static function approvalPushBody(RunnerProfile $record): string
    {
        return empty($record->vehicle_type)
            ? 'Add your vehicle in the app, then go online to start getting errands.'
            : 'Go online in the app to start getting errands.';
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
                // Whether this application is reviewable AT ALL, at a glance — a
                // pending row exists from registration, so without this the dead
                // profiles and the real ones look identical until you open them.
                TextColumn::make('documents_count')
                    ->label('Docs')
                    ->badge()
                    ->tooltip('A review needs a Government ID and a Selfie with ID, neither rejected')
                    ->color(fn ($record): string => match (true) {
                        (int) ($record->required_documents_count ?? 0) >= count(RunnerProfile::REQUIRED_DOCUMENT_TYPES) => 'success',
                        (int) ($record->documents_count ?? 0) === 0 => 'gray',
                        default => 'warning',
                    })
                    ->formatStateUsing(function ($state, $record): string {
                        $total = (int) $state;

                        if ($total === 0) {
                            return 'None yet';
                        }

                        $parts = [$total.' uploaded'];

                        if ((int) ($record->documents_pending_count ?? 0) > 0) {
                            $parts[] = $record->documents_pending_count.' pending';
                        }

                        if ((int) ($record->documents_rejected_count ?? 0) > 0) {
                            $parts[] = $record->documents_rejected_count.' rejected';
                        }

                        return implode(' · ', $parts);
                    }),
                TextColumn::make('vehicle_type')->badge()->color('gray'),
                TextColumn::make('vehicle_plate'),
                IconColumn::make('is_online')->boolean(),
                TextColumn::make('total_errands')->sortable(),
                // Earnings are money figures: money roles only.
                TextColumn::make('total_earnings')->money('PHP')->sortable()
                    ->visible(fn (): bool => self::canSeeMoney()),
                // Waiting since their last document, not since sign-up: an
                // account made weeks ago that sent its ID today has waited
                // minutes, and a resubmission waits from when it was sent.
                TextColumn::make('documents_submitted_at')
                    ->label('Waiting')
                    ->since()
                    ->placeholder('No documents yet')
                    ->sortable()
                    ->badge()
                    ->color(function ($state): string {
                        $hours = $state ? \Illuminate\Support\Carbon::parse($state)->diffInHours(now()) : null;

                        return match (true) {
                            $hours === null => 'gray',
                            $hours >= 72 => 'danger',
                            $hours >= 24 => 'warning',
                            default => 'success',
                        };
                    }),
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
                    ...self::earningsColumn(),
                    'Joined' => fn (RunnerProfile $r) => $r->created_at,
                ], personalData: true),
            ])
            ->toolbarActions([
                ExportCsv::bulk('runners', [
                    'Runner' => fn (RunnerProfile $r): ?string => $r->user?->full_name,
                    'Phone' => fn (RunnerProfile $r): ?string => $r->user?->phone,
                    'Verification' => fn (RunnerProfile $r): ?string => $r->verification_status,
                    'Vehicle' => fn (RunnerProfile $r): ?string => $r->vehicle_type,
                    ...self::earningsColumn(),
                ], personalData: true),
                BulkAction::make('bulkApprove')
                    ->label('Approve selected')
                    ->icon(Heroicon::OutlinedShieldCheck)
                    ->color('success')
                    ->requiresConfirmation()
                    ->modalDescription('Approves every selected runner whose government ID and selfie are both approved, and notifies them. Anyone else is skipped.')
                    ->visible(fn (): bool => static::canModerate())
                    ->deselectRecordsAfterCompletion()
                    ->action(function (Collection $records): void {
                        $approved = 0;
                        $skipped = 0;
                        foreach ($records as $record) {
                            if ($record->verification_status === 'approved') {
                                continue;
                            }
                            // Approving a runner never approves their documents
                            // for them: each one is reviewed on its own first.
                            if (! $record->hasApprovedRequiredDocuments()) {
                                $skipped++;

                                continue;
                            }
                            $record->update(['verification_status' => 'approved', 'approved_at' => now()]);
                            // data.type matters: without it the mobile tap
                            // router no-ops and nothing invalidates the cached
                            // runner profile — the runner reads "approved" while
                            // the app still shows the pending banner and a
                            // locked go-online button. 'document_update' is the
                            // type the app maps to the runner-profile refresh.
                            \App\Jobs\SendPushJob::dispatch(
                                $record->user_id,
                                'Verification Approved!',
                                static::approvalPushBody($record),
                                ['type' => 'document_update'],
                            );
                            AdminActivity::log('runner.approved', $record, ['via' => 'bulk']);
                            $approved++;
                        }
                        // Per-record audit already written in the loop above, so
                        // this is a count-only confirmation (no audit param).
                        $notes = [$approved === 0 ? 'No runner in the selection could be approved.' : 'They’ve been notified.'];
                        if ($skipped > 0) {
                            $notes[] = $skipped.' skipped: their government ID and selfie must both be approved first.';
                        }
                        AdminNotify::success(
                            $approved.' runner'.($approved === 1 ? '' : 's').' approved',
                            note: implode(' ', $notes),
                        );
                    }),
            ])
            ->recordActions([
                ViewAction::make(),

                self::approveAction(),
                self::rejectAction(),
            ]);
    }

    // Approve / reject, shared by the list row and the runner's page (where
    // the documents are reviewed), so staff decide where they read.
    public static function approveAction(bool $explainWhenBlocked = false): Action
    {
        return Action::make('approve')
            ->label('Approve runner')
            ->icon(Heroicon::OutlinedShieldCheck)
            ->color('success')
            ->requiresConfirmation()
            ->modalDescription('Their government ID and selfie are approved. This lets them go online and accept errands.')
            // Only usable once the government ID and selfie are both approved
            // (Documents tab). Approving a runner never approves their
            // documents for them. The list row hides it until then; the
            // runner's page shows it greyed with the reason.
            ->visible(fn ($record): bool => $record->verification_status !== 'approved'
                && static::canModerate()
                && ($explainWhenBlocked || static::documentsApproved($record)))
            ->disabled(fn ($record): bool => ! static::documentsApproved($record))
            ->tooltip(fn ($record): ?string => static::documentsApproved($record)
                ? null
                : 'Approve their government ID and selfie first (Documents tab).')
            ->action(function ($record): void {
                if (! $record->hasApprovedRequiredDocuments()) {
                    AdminNotify::warning(
                        'Runner not approved',
                        'Their government ID and selfie must both be approved first.',
                    );

                    return;
                }

                $record->update([
                    'verification_status' => 'approved',
                    'approved_at' => now(),
                ]);

                // See the bulk action above: the type routes the tap and
                // unlocks the go-online button the moment the push lands.
                \App\Jobs\SendPushJob::dispatch(
                    $record->user_id,
                    'Verification Approved!',
                    static::approvalPushBody($record),
                    ['type' => 'document_update'],
                );

                AdminNotify::success(
                    'Runner approved',
                    $record,
                    context: ['Runner' => $record->user?->full_name],
                    audit: 'runner.approved',
                    note: 'They can now accept errands and have been notified.',
                );
            });
    }

    public static function rejectAction(): Action
    {
        return Action::make('reject')
            ->label('Reject runner')
            ->icon(Heroicon::OutlinedShieldExclamation)
            ->color('danger')
            ->requiresConfirmation()
            ->modalDescription(fn ($record): string => 'Rejects '
                .($record->user?->full_name ?? 'this runner').'’s verification and notifies them with your reason.'
                .($record->verification_status === 'approved'
                    ? ' They are taken offline and get no more errands; any errand they are on now raises an alert so you can hand it to someone else.'
                    : ''))
            ->schema([
                Textarea::make('reason')->required()->maxLength(500),
            ])
            ->visible(fn ($record): bool => $record->verification_status !== 'rejected'
                && static::canModerate())
            ->action(function (array $data, $record): void {
                $wasApproved = $record->verification_status === 'approved';
                $record->update([
                    'verification_status' => 'rejected',
                ]);

                // Revoking an approved runner must be as safe as a
                // suspension: off the map now, and nobody's errand left
                // with someone who can no longer finish it.
                if ($wasApproved && $record->user) {
                    \App\Models\RunnerProfile::switchOffline($record->user_id);
                    app(\App\Services\UserModerationService::class)->flagActiveErrands($record->user, 'rejected');
                }

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
                    ['type' => 'document_update'],
                );

                AdminNotify::success(
                    'Runner rejected',
                    $record,
                    context: ['Runner' => $record->user?->full_name],
                    audit: 'runner.rejected',
                    properties: ['reason' => $data['reason']],
                    note: 'They’ve been notified with your reason.',
                );
            });
    }
}
