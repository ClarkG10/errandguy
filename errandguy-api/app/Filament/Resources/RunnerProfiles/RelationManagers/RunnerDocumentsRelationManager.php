<?php

namespace App\Filament\Resources\RunnerProfiles\RelationManagers;

use App\Filament\Support\AdminNotify;
use App\Jobs\SendPushJob;
use App\Models\AdminUser;
use App\Models\RunnerDocument;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\ImageColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Model;

/**
 * Per-document review for a runner's KYC uploads. Lets an operator approve or
 * reject EACH document individually (with its own reason) instead of the
 * all-or-nothing profile-level approve/reject — so a clear selfie can pass while
 * a blurry ID is rejected with a specific reason. Rejecting a document pushes
 * the runner so they know exactly what to re-upload; the mobile onboarding gate
 * already routes them back to re-upload any non-approved required document.
 *
 * This only sets DOCUMENT status. The overall runner verification_status stays
 * driven by the profile-level "Approve runner" / "Reject runner" actions.
 */
class RunnerDocumentsRelationManager extends RelationManager
{
    protected static string $relationship = 'documents';

    protected static ?string $title = 'Documents';

    protected static string|\BackedEnum|null $icon = 'heroicon-m-document-check';

    protected static ?string $recordTitleAttribute = 'document_type';

    protected static function canModerate(): bool
    {
        return auth('admin')->user()?->hasAnyRole(
            AdminUser::ROLE_SUPER_ADMIN,
            AdminUser::ROLE_ADMIN,
            AdminUser::ROLE_OPS,
        ) ?? false;
    }

    /**
     * The tab renders KYC document thumbnails + a view-file action, so it is
     * moderation-only — finance/support can open a runner profile but must not
     * see ID/selfie images. Without this gate the relation manager is visible to
     * any admin (Gate::before blanket-allows). Mirrors the stream route's gate.
     */
    public static function canViewForRecord(Model $ownerRecord, string $pageClass): bool
    {
        return static::canModerate();
    }

    private static function label(RunnerDocument $record): string
    {
        return ucwords(str_replace('_', ' ', (string) $record->document_type));
    }

    public function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('document_type')
                    ->label('Document')
                    ->formatStateUsing(fn (string $state): string => ucwords(str_replace('_', ' ', $state)))
                    ->weight('semibold'),
                ImageColumn::make('file')->label('File')->height(48)->square()
                    ->state(fn (RunnerDocument $record): ?string => $record->adminFileUrl()),
                TextColumn::make('status')->badge()->color(fn (string $s): string => match ($s) {
                    'approved' => 'success',
                    'rejected' => 'danger',
                    default => 'warning',
                }),
                TextColumn::make('rejection_reason')->label('Reason')->placeholder('—')->limit(40)->wrap(),
                TextColumn::make('reviewed_at')->label('Reviewed')->since()->placeholder('—'),
            ])
            ->recordActions([
                Action::make('view_file')
                    ->label('View')
                    ->icon(Heroicon::OutlinedEye)
                    ->url(fn (RunnerDocument $record): ?string => $record->adminFileUrl())
                    ->openUrlInNewTab()
                    ->visible(fn (RunnerDocument $record): bool => $record->hasFile()),

                Action::make('approve_doc')
                    ->label('Approve')
                    ->icon(Heroicon::OutlinedCheckCircle)
                    ->color('success')
                    ->requiresConfirmation()
                    ->visible(fn (RunnerDocument $record): bool => $record->status !== 'approved' && static::canModerate())
                    ->action(function (RunnerDocument $record): void {
                        $record->update([
                            'status' => 'approved',
                            'rejection_reason' => null,
                            'reviewed_by' => auth('admin')->id(),
                            'reviewed_at' => now(),
                        ]);

                        AdminNotify::success(
                            'Document approved',
                            $record,
                            context: ['Document' => static::label($record)],
                            audit: 'runner.document.approved',
                        );
                    }),

                Action::make('reject_doc')
                    ->label('Reject')
                    ->icon(Heroicon::OutlinedXCircle)
                    ->color('danger')
                    ->visible(fn (RunnerDocument $record): bool => $record->status !== 'rejected' && static::canModerate())
                    ->schema([
                        Textarea::make('reason')
                            ->label('Reason (shown to the runner)')
                            ->required()
                            ->maxLength(500),
                    ])
                    ->action(function (array $data, RunnerDocument $record): void {
                        $record->update([
                            'status' => 'rejected',
                            'rejection_reason' => $data['reason'],
                            'reviewed_by' => auth('admin')->id(),
                            'reviewed_at' => now(),
                        ]);

                        // Tell the runner exactly which document to fix. runner_id
                        // on the document is the RunnerProfile id, so hop to the
                        // profile for the user id the push targets.
                        $userId = $record->runnerProfile?->user_id;
                        if ($userId) {
                            SendPushJob::dispatch(
                                $userId,
                                'Document needs another look',
                                'Your '.static::label($record).' wasn’t approved: '.$data['reason'].' Please re-upload it.',
                                ['type' => 'document_update'],
                            );
                        }

                        AdminNotify::success(
                            'Document rejected',
                            $record,
                            context: ['Document' => static::label($record)],
                            audit: 'runner.document.rejected',
                            properties: ['reason' => $data['reason']],
                        );
                    }),
            ]);
    }
}
