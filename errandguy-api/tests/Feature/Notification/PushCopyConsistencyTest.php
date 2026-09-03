<?php

namespace Tests\Feature\Notification;

use App\Events\BookingStatusChanged;
use App\Listeners\SendBookingStatusNotification;
use App\Models\Booking;
use App\Models\ErrandType;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use ReflectionClass;
use Tests\TestCase;

/**
 * The Alerts inbox renders `notifications.title` verbatim, so every title in
 * this listener lands in one scrolling list for one customer. The base
 * TEMPLATES were the older Title-Case half ("Runner Found!", "Item Picked Up",
 * "In Transit") and the per-errand-type TYPE_OVERRIDES were the newer
 * sentence-case half ("Ride started", "Bill paid") — both reaching the same
 * inbox through the same $deliver closure, so the inbox read as if it had been
 * assembled from two different products. The base set also flipped the
 * object's name mid-flow ("Your errand #x is on the way", then "Booking #x has
 * been cancelled").
 *
 * These are arch guards over the two const arrays: one voice, one noun.
 */
class PushCopyConsistencyTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Every title/body string in both arrays, flattened to
     * "path" => "string" so a failure names the offending entry.
     *
     * @return array<string, string>
     */
    private function copyStrings(string $const): array
    {
        $array = (new ReflectionClass(SendBookingStatusNotification::class))
            ->getConstant($const);

        $out = [];
        $walk = function (array $node, string $path) use (&$walk, &$out): void {
            foreach ($node as $key => $value) {
                if (is_array($value)) {
                    $walk($value, $path === '' ? (string) $key : $path.'.'.$key);

                    continue;
                }
                $out[$path.'.'.$key] = $value;
            }
        };
        $walk($array, '');

        return $out;
    }

    /**
     * @return array<string, string>
     */
    private function allTitles(): array
    {
        $titles = [];
        foreach (['TEMPLATES', 'TYPE_OVERRIDES'] as $const) {
            foreach ($this->copyStrings($const) as $path => $value) {
                if (str_ends_with($path, '.title')) {
                    $titles[$const.'.'.$path] = $value;
                }
            }
        }

        return $titles;
    }

    public function test_every_push_title_is_sentence_case(): void
    {
        foreach ($this->allTitles() as $path => $title) {
            // Sentence case: capital first letter, no further capitals. Every
            // current title is an ordinary phrase with no proper nouns — if one
            // ever needs "ErrandGuy" in it, widen this deliberately.
            $this->assertMatchesRegularExpression(
                '/^[A-Z][^A-Z]*$/u',
                $title,
                "{$path} is not sentence case: \"{$title}\" — the inbox shows it next to the per-type overrides, which are.",
            );
        }
    }

    public function test_no_push_title_shouts(): void
    {
        foreach ($this->allTitles() as $path => $title) {
            $this->assertStringNotContainsString(
                '!',
                $title,
                "{$path} ends in an exclamation mark; nothing else in the inbox does.",
            );
        }
    }

    public function test_the_object_is_always_an_errand_never_a_booking(): void
    {
        foreach (['TEMPLATES', 'TYPE_OVERRIDES'] as $const) {
            foreach ($this->copyStrings($const) as $path => $value) {
                // "booking" as a VERB is fine ("Tap to try booking again") —
                // what must never appear is the object noun, which is what
                // made one errand read as two different things.
                $this->assertDoesNotMatchRegularExpression(
                    '/\b[Bb]ooking\s+#/u',
                    $value,
                    "{$const}.{$path} names the object a booking: \"{$value}\"",
                );
                $this->assertDoesNotMatchRegularExpression(
                    '/\b(your|this|the|a)\s+booking\b/iu',
                    $value,
                    "{$const}.{$path} names the object a booking: \"{$value}\"",
                );
            }
        }
    }

    /**
     * The per-type overrides exist precisely so a ride/bill/queue is not
     * described as a parcel. Pin the two that the in-app labels mirror
     * (mobile `constants/statusLabels.ts` reads the same words), so the push
     * and the screen the push deep-links into cannot drift apart again.
     */
    public function test_no_runner_wording_is_pinned_across_types(): void
    {
        $overrides = (new ReflectionClass(SendBookingStatusNotification::class))
            ->getConstant('TYPE_OVERRIDES');
        $templates = (new ReflectionClass(SendBookingStatusNotification::class))
            ->getConstant('TEMPLATES');

        $this->assertSame('No runner available', $templates['no_runner']['customer']['title']);
        $this->assertSame('No driver available', $overrides['transportation']['no_runner']['customer']['title']);
        $this->assertSame('No runner available', $overrides['bills_payment']['no_runner']['customer']['title']);
        $this->assertSame('No runner available', $overrides['queue']['no_runner']['customer']['title']);
    }

    /**
     * Every LITERAL push/in-app title anywhere in `app/`, found by walking the
     * PHP token stream for the four NotificationService entry points and
     * taking argument #1 when it is a plain string.
     *
     * The reflection guards above only ever covered this ONE listener's two
     * const arrays — which is exactly how the siblings drifted: the very first
     * push a customer received said "Booking Confirmed", the cancel said
     * "Booking Cancelled", and SOS/PIN shipped "SOS Alert" / "PIN Verified".
     * All of those land in the SAME Alerts inbox as the templates.
     *
     * Titles built from variables are skipped (nothing to assert statically) —
     * `SendBookingCreatedNotification` composes its two bodies that way, and
     * its title is pinned behaviourally below instead.
     *
     * @return array<string, string> "file:line" => title
     */
    private function literalPushTitles(): array
    {
        $methods = ['sendPush', 'notifyInApp', 'sendRemotePush', 'sendRemotePushToMany'];
        $found = [];

        $files = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator(app_path(), \FilesystemIterator::SKIP_DOTS),
        );

        foreach ($files as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }

            $tokens = token_get_all((string) file_get_contents($file->getPathname()));
            $count = count($tokens);

            for ($i = 0; $i < $count; $i++) {
                $tok = $tokens[$i];
                if (! is_array($tok) || $tok[0] !== T_STRING || ! in_array($tok[1], $methods, true)) {
                    continue;
                }

                // Must be a method call: `->name(` or `?->name(`.
                $prev = $tokens[$i - 1] ?? null;
                if (! is_array($prev) || ! in_array($prev[0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR], true)) {
                    continue;
                }

                $j = $i + 1;
                while ($j < $count && ! ($tokens[$j] === '(')) {
                    // Only whitespace may sit between the name and the paren.
                    if (! (is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE)) {
                        break;
                    }
                    $j++;
                }
                if (($tokens[$j] ?? null) !== '(') {
                    continue;
                }

                // Walk the argument list, splitting on TOP-LEVEL commas and
                // discarding whitespace and comments (both appear between
                // arguments in this codebase).
                $depth = 0;
                $args = [[]];
                for ($k = $j; $k < $count; $k++) {
                    $t = $tokens[$k];

                    if (is_string($t)) {
                        if (in_array($t, ['(', '[', '{'], true)) {
                            $depth++;
                            if ($depth === 1) {
                                continue;
                            }
                        } elseif (in_array($t, [')', ']', '}'], true)) {
                            $depth--;
                            if ($depth === 0) {
                                break;
                            }
                        } elseif ($t === ',' && $depth === 1) {
                            $args[] = [];

                            continue;
                        }
                    } elseif (in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                        continue;
                    }

                    $args[count($args) - 1][] = $t;
                }

                $title = $args[1] ?? [];
                if (count($title) !== 1 || ! is_array($title[0]) || $title[0][0] !== T_CONSTANT_ENCAPSED_STRING) {
                    continue;
                }

                $key = str_replace(base_path().'/', '', $file->getPathname()).':'.$tok[2];
                $found[$key] = trim($title[0][1], "'\"");
            }
        }

        return $found;
    }

    /**
     * Sentence case, ACRONYM-TOLERANT: an all-caps word (SOS, PIN) is a real
     * word in these titles, so the strict rule used for the template consts
     * would reject the correct spelling. Every other word must be lowercase,
     * and only the first may be capitalised.
     */
    public function test_every_literal_push_title_in_the_app_is_sentence_case(): void
    {
        $titles = $this->literalPushTitles();

        // Guard the guard. A token walk that silently stops matching would let
        // this test pass vacuously forever, so pin the sites that actually
        // regressed: two of these are past comments between the arguments and
        // one is inside a nested array call, which is where a naive regex
        // scanner breaks first.
        $this->assertGreaterThan(5, count($titles), 'the push-title scanner found almost nothing — it has stopped working');

        foreach ([
            'app/Jobs/NotifySosContactsJob.php' => 'SOS alert',
            'app/Services/SOSService.php' => 'SOS resolved',
            'app/Http/Controllers/Runner/RunnerErrandController.php' => 'PIN verified',
            'app/Listeners/SendBookingCancelledNotification.php' => 'Errand cancelled',
        ] as $file => $expected) {
            $hits = [];
            foreach ($titles as $where => $title) {
                if (str_starts_with($where, $file.':')) {
                    $hits[] = $title;
                }
            }
            $this->assertContains(
                $expected,
                $hits,
                "the scanner no longer reaches {$file} — it would stop catching regressions there",
            );
        }

        foreach ($titles as $where => $title) {
            foreach (preg_split('/\s+/u', $title) as $index => $word) {
                $bare = preg_replace('/[^\p{L}]/u', '', $word) ?? '';
                if ($bare === '') {
                    continue;
                }
                // All-caps acronym of 2+ letters is allowed anywhere.
                if (mb_strlen($bare) >= 2 && $bare === mb_strtoupper($bare)) {
                    continue;
                }

                $expected = $index === 0
                    ? mb_strtoupper(mb_substr($bare, 0, 1)).mb_strtolower(mb_substr($bare, 1))
                    : mb_strtolower($bare);

                $this->assertSame(
                    $expected,
                    $bare,
                    "{$where} title \"{$title}\" is not sentence case — it shares one Alerts inbox with every other push.",
                );
            }
        }
    }

    public function test_no_literal_push_title_names_the_object_a_booking(): void
    {
        foreach ($this->literalPushTitles() as $where => $title) {
            $this->assertDoesNotMatchRegularExpression(
                '/\bbooking\b/iu',
                $title,
                "{$where} title \"{$title}\" names the object a booking; it is an errand everywhere else.",
            );
        }
    }

    public function test_a_delivered_errand_stores_the_sentence_case_title(): void
    {
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok']]], 200)]);

        $customer = User::factory()->create(['role' => 'customer', 'status' => 'active']);
        $type = ErrandType::create([
            'slug' => 'delivery', 'name' => 'Delivery', 'description' => 'D',
            'icon_name' => 'Package', 'base_fee' => 50, 'per_km_walk' => 15, 'per_km_bicycle' => 12,
            'per_km_motorcycle' => 10, 'per_km_car' => 18, 'min_negotiate_fee' => 30,
            'is_active' => true, 'sort_order' => 1,
        ]);
        $booking = Booking::create([
            'booking_number' => 'EG-T-'.uniqid(),
            'customer_id' => $customer->id,
            'errand_type_id' => $type->id,
            'pickup_address' => 'A', 'pickup_lat' => 14.60, 'pickup_lng' => 120.98,
            'dropoff_address' => 'B', 'dropoff_lat' => 14.55, 'dropoff_lng' => 121.02,
            'schedule_type' => 'now', 'pricing_mode' => 'fixed', 'vehicle_type_rate' => 'motorcycle',
            'distance_km' => 5.0, 'base_fee' => 50, 'distance_fee' => 50, 'service_fee' => 15,
            'surcharge' => 0, 'total_amount' => 115, 'runner_payout' => 85,
            'is_transportation' => false, 'status' => 'picked_up',
        ]);

        app(SendBookingStatusNotification::class)
            ->handle(new BookingStatusChanged($booking, 'arrived_at_pickup', 'picked_up'));

        $this->assertSame(
            'Item picked up',
            Notification::where('user_id', $customer->id)->value('title'),
        );
    }
}
