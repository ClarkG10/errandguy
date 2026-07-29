<?php

namespace App\Filament\Support;

use App\Support\AdminCache;

/**
 * Helper for list-page triage tabs: fetches a single grouped COUNT map per
 * resource (one query, cached 60s) so a page with several tab badges doesn't
 * fire one COUNT per tab against the remote DB on every render.
 */
class ListTabs
{
    /**
     * @return array<string, int>  column-value => row-count
     */
    public static function counts(string $key, string $modelClass, string $column): array
    {
        return AdminCache::rememberFor('admin:tabs:'.$key, 60, fn (): array => $modelClass::query()
            ->selectRaw($column.' as k, count(*) as c')
            ->groupBy($column)
            ->pluck('c', 'k')
            ->map(fn ($v): int => (int) $v)
            ->all());
    }

    /** Sum of counts for the given values (nulls treated as 0). */
    public static function sum(array $counts, string ...$values): int
    {
        $total = 0;
        foreach ($values as $v) {
            $total += (int) ($counts[$v] ?? 0);
        }

        return $total;
    }
}
