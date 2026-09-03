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
