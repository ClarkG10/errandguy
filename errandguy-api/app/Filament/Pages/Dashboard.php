<?php

namespace App\Filament\Pages;

use Filament\Pages\Dashboard as BaseDashboard;
use Filament\Support\Icons\Heroicon;

/**
 * ErrandGuy operations "command center" dashboard.
 *
 * Overrides the stock Filament dashboard to use a 6-column grid so the widget
 * fleet (KPIs → action queue → charts → leaderboards) composes into a
 * deliberate ops layout instead of a single stacked column. Widget placement
 * is driven by each widget's $sort + $columnSpan.
 */
class Dashboard extends BaseDashboard
{
    protected static string|\BackedEnum|null $navigationIcon = Heroicon::OutlinedHome;

    public function getColumns(): int|array
    {
        return 6;
    }

    public function getSubheading(): ?string
    {
        return 'Live view of the marketplace — '.now()->timezone('Asia/Manila')->format('D, j M Y · g:i A').' (PHT)';
    }
}
