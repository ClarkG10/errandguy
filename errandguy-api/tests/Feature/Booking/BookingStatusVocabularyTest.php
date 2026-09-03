<?php

namespace Tests\Feature\Booking;

use App\Enums\BookingStatus;
use App\Policies\BookingPolicy;
use ReflectionClass;
use Tests\TestCase;

/**
 * Arch guards over the booking-status vocabulary.
 *
 * `bookings.status` is a plain varchar written from ~680 string literals across
 * 35 files, so a typo does not fail — it creates a branch that can never be
 * reached. That has already happened once: `SendBookingStatusNotification`
 * carries a `cancelled` template that nothing can trigger, because every cancel
 * path raises BookingCancelled instead.
 *
 * The two things worth pinning are therefore:
 *   1. Every status literal in app/ is a real status.
 *   2. The two SETS keep meaning different things — see the class docblock on
 *      BookingStatus. Collapsing them is the tempting "cleanup" that breaks
 *      retryMatch in one direction and the write guards in the other.
 *   3. The mobile app has a label for every status, so a new one can never
 *      reach a customer as a raw slug ("heading_to_pickup").
 */
class BookingStatusVocabularyTest extends TestCase
{
    /**
     * The real status `$value` is one edit away from, or null if it is not a
     * near-miss at all.
     */
    private function nearMissOf(string $value): ?string
    {
        if (strlen($value) <= 4) {
            return null;
        }

        foreach (BookingStatus::values() as $real) {
            if ($value === $real) {
                return null;
            }
            // A clean substring of a real status is the signature of a
            // str_contains() NEEDLE — deliberate partial matching, e.g. the
            // activity-log badge colouring on event names that merely contain
            // "complete". A typo is almost never a clean substring
            // ("completd", "canceled"), so excluding these costs the net
            // nothing and removes its only false positive.
            if (str_contains($real, $value)) {
                return null;
            }
            if (
                str_contains($value, '_') === str_contains($real, '_')
                && levenshtein($value, $real) === 1
            ) {
                return $real;
            }
        }

        return null;
    }

    /**
     * Guard the guard. A detector that has been narrowed into uselessness would
     * pass this suite forever while catching nothing, so pin both directions on
     * synthetic input.
     */
    public function test_the_typo_detector_actually_detects_typos(): void
    {
        // Real typos — each one character from a real status, none a substring.
        $this->assertSame('completed', $this->nearMissOf('completd'));
        $this->assertSame('cancelled', $this->nearMissOf('canceled'));
        $this->assertSame('in_transit', $this->nearMissOf('in_transt'));
        $this->assertSame('no_runner', $this->nearMissOf('no_runer'));

        // Not typos, and each one is a shape the scanner meets constantly.
        $this->assertNull($this->nearMissOf('completed'), 'a real status is not a typo');
        $this->assertNull($this->nearMissOf('complete'), 'a str_contains needle is deliberate');
        $this->assertNull($this->nearMissOf('paid'), 'an unrelated short word');
        $this->assertNull($this->nearMissOf('processing'), 'a payment status, not a booking one');
    }

    /**
     * Statuses referenced as literals anywhere in app/, harvested from the PHP
     * token stream. Only strings that LOOK like a booking status are considered
     * (snake_case, in the shape the column uses) — this is a typo net, not an
     * exhaustive census.
     *
     * @return array<string, string> "file:line" => literal
     */
    private function statusLikeLiterals(): array
    {
        $found = [];
        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(app_path(), \FilesystemIterator::SKIP_DOTS),
        );

        foreach ($files as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            $rel = str_replace(base_path().'/', '', $file->getPathname());

            // Payment/wallet/document/ticket statuses share words like
            // 'completed' and 'pending' with the booking column, so files whose
            // subject is a different status machine would produce pure noise.
            if (preg_match('#(Payment|Wallet|Payout|Dispute|Support|Kyc|Document|Enums)#i', $rel)) {
                continue;
            }

            foreach (token_get_all((string) file_get_contents($file->getPathname())) as $tok) {
                if (! is_array($tok) || $tok[0] !== T_CONSTANT_ENCAPSED_STRING) {
                    continue;
                }
                $value = trim($tok[1], "'\"");

                // Must have the SHAPE of a stored status: lowercase snake_case,
                // no spaces. Without this the net catches every display label
                // ("Completed", "Delivered") and every fragment with a leading
                // space (" pending" in a concatenated chart legend) — all of
                // which are one edit from a real status and none of which are
                // ever compared against the column.
                if (! preg_match('/^[a-z][a-z_]*$/', $value)) {
                    continue;
                }
                if ($this->nearMissOf($value) !== null) {
                    $found[$rel.':'.$tok[2]] = $value;
                }
            }
        }

        return $found;
    }

    public function test_no_near_miss_status_literal_exists_in_the_app(): void
    {
        $suspects = $this->statusLikeLiterals();

        $this->assertSame(
            [],
            $suspects,
            "These literals are one character from a real booking status, which on a plain varchar\n"
                ."column means a branch that silently never runs:\n  "
                .implode("\n  ", array_map(
                    fn ($k, $v) => "{$k} => \"{$v}\"",
                    array_keys($suspects),
                    $suspects,
                )),
        );
    }

    /**
     * The distinction the enum exists to protect. If someone "tidies" these
     * into one set, this test says which behaviour they just broke.
     */
    public function test_ended_and_finalized_are_deliberately_different(): void
    {
        $this->assertContains('no_runner', BookingStatus::ENDED);
        $this->assertNotContains('no_runner', BookingStatus::FINALIZED);

        // ENDED = nobody is working it. FINALIZED = settled, admits no further
        // work. A no_runner booking is the first but not the second, because
        // the customer retries from exactly that state.
        $this->assertTrue(BookingStatus::isEnded('no_runner'));
        $this->assertFalse(BookingStatus::isFinalized('no_runner'));
    }

    /**
     * The concrete behaviour that made this distinction load-bearing: the
     * customer's active-bookings list must keep showing a no_runner errand,
     * because that row is what the tracking screen's one-tap "Book again" acts
     * on — and money has already been refunded against it.
     */
    public function test_a_failed_match_is_still_retryable_so_it_must_stay_visible(): void
    {
        // Booking::scopeActive() hides FINALIZED, not ENDED — so no_runner survives.
        $this->assertFalse(BookingStatus::isFinalized('no_runner'));

        // …and the policy that reads that row agrees it is retryable.
        $source = file_get_contents(
            (new ReflectionClass(BookingPolicy::class))->getFileName(),
        );
        $this->assertMatchesRegularExpression(
            "/retryMatch.*?'no_runner'/s",
            $source,
            'retryMatch no longer accepts no_runner — scopeActive should stop including it too',
        );
    }

    public function test_every_status_has_a_label_in_the_mobile_app(): void
    {
        $labels = base_path('../errandguy-mobile/src/constants/statusLabels.ts');
        if (! is_file($labels)) {
            $this->markTestSkipped('mobile repo not checked out alongside the API');
        }

        $source = (string) file_get_contents($labels);

        // STATUS_LABELS is the base map every other surface layers on top of.
        // A status missing from it renders to the customer as a raw slug.
        $block = strstr($source, 'export const STATUS_LABELS');
        $block = $block === false ? '' : substr($block, 0, (int) strpos($block, '};'));

        foreach (BookingStatus::values() as $status) {
            $this->assertStringContainsString(
                "{$status}:",
                $block,
                "the app has no label for '{$status}' — a customer would see the raw slug",
            );
        }
    }
}
