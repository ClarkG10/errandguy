<?php

use App\Models\AdminAlert;
use App\Support\PhilippinePhone;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Store every account's phone as +639XXXXXXXXX, the one shape sign-up, sign-in
 * and profile edits now write and look up. Before this, "09171234567" and
 * "+639171234567" were two different accounts' worth of number, and signing in
 * with the other spelling found nobody.
 *
 * Two accounts can hold the same number in different spellings. Those are
 * never merged or deleted: the account that registered first gets the
 * canonical spelling (unless the later one already holds it, in which case
 * neither changes), every other account in the group is left exactly as it is,
 * and staff get one AdminAlert listing the pairs to sort out by hand. A value
 * that isn't a PH mobile number is left as it is too.
 *
 * Soft-deleted accounts are included (the unique index covers them). Only
 * values that change are written, so a re-run is a no-op. down() does
 * nothing: the original spellings aren't kept.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'phone')) {
            return;
        }

        /** @var array<string, array<int, object>> $groups canonical number => accounts */
        $groups = [];
        $unparseable = 0;

        foreach (DB::table('users')->whereNotNull('phone')->where('phone', '!=', '')
            ->select('id', 'phone', 'full_name', 'created_at')->orderBy('id')->cursor() as $row) {
            $canonical = PhilippinePhone::canonical($row->phone);
            if ($canonical === null) {
                $unparseable++;

                continue;
            }
            $groups[$canonical][] = $row;
        }

        $updated = 0;
        $collisions = [];

        foreach ($groups as $canonical => $rows) {
            usort($rows, fn ($a, $b) => [(string) $a->created_at, $a->id] <=> [(string) $b->created_at, $b->id]);

            if (count($rows) === 1) {
                if ($rows[0]->phone !== $canonical) {
                    DB::table('users')->where('id', $rows[0]->id)->update(['phone' => $canonical]);
                    $updated++;
                }

                continue;
            }

            // Several accounts, one number. Whoever already holds the canonical
            // spelling keeps it; otherwise the first to register gets it.
            $holder = collect($rows)->first(fn ($r) => $r->phone === $canonical);
            if ($holder === null) {
                $holder = $rows[0];
                DB::table('users')->where('id', $holder->id)->update(['phone' => $canonical]);
                $updated++;
            }

            foreach ($rows as $row) {
                if ($row->id !== $holder->id) {
                    $collisions[] = [$holder, $row];
                }
            }
        }

        if ($unparseable > 0) {
            Log::warning('[phone-normalize] left phone numbers that are not PH mobile numbers unchanged', [
                'count' => $unparseable,
            ]);
        }

        if ($collisions === []) {
            return;
        }

        $label = fn (object $u) => ($u->full_name ?: 'Unnamed').' ('.$u->id.')';
        $lines = array_map(
            fn (array $pair) => '• '.$label($pair[0]).' kept the number; '.$label($pair[1]).' was left unchanged',
            $collisions,
        );

        Log::warning('[phone-normalize] accounts share a phone number in different spellings; left for staff', [
            'pairs' => array_map(fn (array $pair) => [$pair[0]->id, $pair[1]->id], $collisions),
        ]);

        AdminAlert::raise(
            'phone_number_collision',
            'warning',
            count($collisions).' account'.(count($collisions) === 1 ? '' : 's').' share a phone number with another account',
            "Phone numbers are now stored as +639XXXXXXXXX. These accounts held the same number written differently, "
                ."so only the first was converted and the other was left as it was (it can't sign in with that number "
                ."until it is fixed). Check with each person which account is theirs and change or remove the "
                ."duplicate number:\n".implode("\n", $lines),
        );
    }

    public function down(): void
    {
        // The original spellings aren't kept; +639XXXXXXXXX is valid everywhere.
    }
};
