<?php

namespace App\Filament\Resources\RunnerProfiles\Pages;

use App\Filament\Resources\RunnerProfiles\RunnerProfileResource;
use App\Filament\Support\ListTabs;
use App\Models\RunnerProfile;
use Filament\Resources\Pages\ListRecords;
use Filament\Schemas\Components\Tabs\Tab;
use Illuminate\Database\Eloquent\Builder;

class ListRunnerProfiles extends ListRecords
{
    protected static string $resource = RunnerProfileResource::class;

    public function getTabs(): array
    {
        $c = ListTabs::counts('runners', RunnerProfile::class, 'verification_status');

        // "Pending" was one bucket, but a profile row exists from registration —
        // before a single document is uploaded — so an oldest-first pending list
        // was permanently head-blocked by applications that can never be
        // reviewed. Split it: the queue an operator works (and lands on) holds
        // only applications with every required document on file; the rest stay
        // visible, and counted, under Incomplete.
        $ready = RunnerProfileResource::readyForReviewCount();
        $incomplete = max(ListTabs::sum($c, 'pending') - $ready, 0);

        return [
            'ready' => Tab::make('Ready to review')->icon('heroicon-m-inbox-arrow-down')->badgeColor('warning')
                ->badge($ready)
                // SLA queue: oldest application on top so the longest-waiting
                // runner is reviewed first. The asc order is applied to the base
                // query before the table's default created_at,desc, and being the
                // first orderBy clause on the same column it wins.
                ->modifyQueryUsing(fn (Builder $query): Builder => $query
                    ->pending()
                    ->readyForReview()
                    ->orderBy('created_at', 'asc')),
            'incomplete' => Tab::make('Incomplete')->icon('heroicon-m-ellipsis-horizontal-circle')->badgeColor('gray')
                ->badge($incomplete)
                // Deliberately NOT oldest-first: this is a signup funnel, not a
                // work queue — the newest are the ones still likely to finish.
                ->modifyQueryUsing(fn (Builder $query): Builder => $query
                    ->pending()
                    ->awaitingDocuments()),
            'all' => Tab::make('All')->badge(array_sum($c)),
            'approved' => Tab::make('Approved')->icon('heroicon-m-shield-check')->badgeColor('success')
                ->badge(ListTabs::sum($c, 'approved'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('verification_status', 'approved')),
            'rejected' => Tab::make('Rejected')->icon('heroicon-m-shield-exclamation')->badgeColor('danger')
                ->badge(ListTabs::sum($c, 'rejected'))
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('verification_status', 'rejected')),
            'online' => Tab::make('Online now')->icon('heroicon-m-signal')
                ->modifyQueryUsing(fn (Builder $query): Builder => $query->where('is_online', true)),
        ];
    }
}
