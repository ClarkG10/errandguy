<?php

namespace App\Http\Resources;

use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\SOSAlert;
use App\Models\User;
use App\Services\BookingService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BookingResource extends JsonResource
{
    /** How item money is settled on a shopping errand, for both apps to show. */
    public const ITEMS_PAYMENT_NOTE = 'Items are paid in cash to the runner at the door. They are not charged online.';

    public function toArray(Request $request): array
    {
        // If the viewer isn't a participant, hide pickup / dropoff contact
        // phone + name so nobody outside the errand can harvest leads. Same
        // for receipts / signatures / item photos.
        $isParticipant = $this->isParticipant();
        $isAdmin = $request->user() instanceof AdminUser;
        $canSeeContacts = $isParticipant || $isAdmin;

        // A runner who was only OFFERED the errand has not taken it and may
        // decline: no phone numbers — the customer's or the pick-up / drop-off
        // contacts' — until they accept. Keyed on the accept itself, not the
        // status: a customer cancelling during the offer leaves the offered
        // runner on the row, and the phones then showed up in their history.
        $isOfferedRunner = $this->accepted_at === null
            && $request->user() instanceof User
            && $request->user()->id === $this->runner_id;
        $canSeePhones = $canSeeContacts && ! $isOfferedRunner;

        // Runner-facing operational metadata (payment method type, cash to
        // collect, distance to pickup). Scoped to runner/admin viewers: the
        // customer's own screens already have their own payment section, and
        // the public trip page (no authenticated user) must stay unchanged.
        $viewer = $request->user();
        $canSeeRunnerOps = $isAdmin
            || ($viewer instanceof User && $viewer->role === 'runner');

        // Reviews are bidirectional (customer→runner AND runner→customer), so
        // a booking can hold two rows keyed by reviewer_id. Resolve them by
        // role from the loaded collection instead of the old ambiguous hasOne,
        // which returned an arbitrary single row once both parties had rated.
        $reviews = $this->relationLoaded('reviews') ? $this->reviews : null;
        $customerReview = $reviews?->firstWhere('reviewer_id', $this->customer_id);
        $runnerReview = $this->runner_id
            ? $reviews?->firstWhere('reviewer_id', $this->runner_id)
            : null;

        // What a cancellation (or an unmatched booking's auto-refund) actually
        // did to the money. Derived here rather than client-side so every
        // durable surface — the tracking receipt, the activity detail sheet,
        // admin — tells the same story the cancel receipt told at the moment
        // of cancelling.
        $refundedAmount = $this->refundedAmount();

        // A GCash/Maya errand still waiting for its payment (nothing is
        // searched for until it lands). Only its own customer gets the way back
        // into the checkout.
        $awaitingPayment = BookingService::awaitingPayment($this->resource);
        $isOwner = $viewer instanceof User && $viewer->id === $this->customer_id;

        // The customer meets their runner when the runner ACCEPTS. While the
        // errand is only offered the runner may decline and is a stranger, and
        // a free cancel at this point made it possible to book anywhere and
        // learn who the nearest runner is: no name, face or number until then.
        // The phone is for reaching them during the errand, so it goes again
        // once the errand ends (it used to stay in the order history).
        // Keyed on the accept itself: a customer who cancels during the offer
        // leaves the offered runner on the row and must not see them then
        // either.
        $runnerHiddenFromCustomer = $isOwner && $this->accepted_at === null;
        $runnerPhoneHiddenFromCustomer = $isOwner && ! in_array($this->status, \App\Enums\BookingStatus::IN_PROGRESS, true);

        return [
            'id' => $this->id,
            'booking_number' => $this->booking_number,
            // Expose participant FKs so the mobile client can derive
            // ownership without an extra round-trip. Both are scoped by
            // the controller queries (runnerBookings / customerBookings)
            // so non-participants never see this resource.
            'customer_id' => $this->customer_id,
            'runner_id' => $this->runner_id,
            'errand_type_id' => $this->errand_type_id,
            'status' => $this->status,
            'errand_type' => $this->when(
                $this->relationLoaded('errandType'),
                fn () => new ErrandTypeResource($this->errandType),
            ),
            'runner' => $this->when(
                $this->relationLoaded('runner') && $this->runner && ! $runnerHiddenFromCustomer,
                fn () => (new UserResource($this->runner))->withoutPhone($runnerPhoneHiddenFromCustomer),
            ),
            'customer' => $this->when(
                $this->relationLoaded('customer') && $this->customer,
                fn () => (new UserResource($this->customer))->withoutPhone($isOfferedRunner),
            ),
            'pickup_address' => $this->pickup_address,
            'pickup_lat' => $this->pickup_lat,
            'pickup_lng' => $this->pickup_lng,
            'pickup_contact_name' => $this->when($canSeeContacts, $this->pickup_contact_name),
            'pickup_contact_phone' => $this->when($canSeeContacts, $canSeePhones ? $this->pickup_contact_phone : null),
            'dropoff_address' => $this->dropoff_address,
            'dropoff_lat' => $this->dropoff_lat,
            'dropoff_lng' => $this->dropoff_lng,
            'dropoff_contact_name' => $this->when($canSeeContacts, $this->dropoff_contact_name),
            'dropoff_contact_phone' => $this->when($canSeeContacts, $canSeePhones ? $this->dropoff_contact_phone : null),
            // Multi-stop: extra destinations after the primary dropoff. Contacts
            // follow the same masking as the dropoff contact (non-participants
            // see none; an offered runner sees no phone).
            // Kept as [] (not omitted) when loaded-but-empty so the mobile
            // `stops: BookingStop[]` contract holds.
            'stops' => $this->when(
                $this->relationLoaded('stops'),
                fn () => $this->stops->map(fn ($stop) => [
                    'id' => $stop->id,
                    'sequence' => $stop->sequence,
                    'address' => $stop->address,
                    'lat' => $stop->lat,
                    'lng' => $stop->lng,
                    'contact_name' => $canSeeContacts ? $stop->contact_name : null,
                    'contact_phone' => $canSeePhones ? $stop->contact_phone : null,
                    'note' => $stop->note,
                    'completed_at' => $stop->completed_at,
                ])->values(),
            ),
            'description' => $this->description,
            'special_instructions' => $this->special_instructions,
            // Customer-uploaded item photos can be documents / prescriptions /
            // IDs — hidden from non-participants, as the comment above promises.
            // Kept as [] (not omitted) so the mobile `string[]` contract holds.
            'item_photos' => $this->when($canSeeContacts, $this->item_photos, []),
            'estimated_item_value' => $this->estimated_item_value,
            // "Buy for me" item money. The runner pays for the items out of
            // pocket, up to shopping_budget (the customer's spending limit —
            // nothing is held or charged against it), and reports what they
            // actually paid (actual_item_cost) with the receipt. The customer
            // repays exactly that, in cash at the door: item money is never
            // charged online, never part of total_amount, and never refunded.
            'shopping_budget' => $this->shopping_budget,
            // Itemized shopping checklist (array of {id,name,qty,checked,checked_at}).
            // Null-safe: the `array` cast yields null when no list was ever set.
            'shopping_items' => $this->shopping_items ?? [],
            'actual_item_cost' => $this->actual_item_cost,
            // What the customer owes the runner for the items, in cash — known
            // once the runner reports it (else null).
            'items_cash_due' => $this->actual_item_cost !== null ? round((float) $this->actual_item_cost, 2) : null,
            // Shopping errands only; null otherwise.
            'items_payment_note' => $this->shopping_budget !== null || $this->actual_item_cost !== null
                ? self::ITEMS_PAYMENT_NOTE
                : null,
            'receipt_photo_url' => $this->when($canSeeContacts, $this->receipt_photo_url),
            'schedule_type' => $this->schedule_type,
            'scheduled_at' => $this->scheduled_at,
            // History only: every booking is fixed price now ('fixed'), so this,
            // customer_offer and negotiate_expires_at below only carry a value on
            // a booking made while "name your price" existed.
            'pricing_mode' => $this->pricing_mode,
            'vehicle_type_rate' => $this->vehicle_type_rate,
            // The vehicle the customer booked (same value as vehicle_type_rate),
            // under the name the runner's offer screens read.
            'vehicle_type' => $this->vehicle_type_rate,
            'distance_km' => $this->distance_km,
            'base_fee' => $this->base_fee,
            'distance_fee' => $this->distance_fee,
            'service_fee' => $this->service_fee,
            'surcharge' => $this->surcharge,
            'promo_discount' => $this->promo_discount,
            'total_amount' => $this->total_amount,
            'customer_offer' => $this->customer_offer,
            'runner_payout' => $this->runner_payout,
            // The mobile Booking type has declared tip_amount all along; the
            // server simply never sent it, so every runner-side surface that
            // could have shown a tip rendered nothing.
            'tip_amount' => $this->tip_amount,
            'negotiate_expires_at' => $this->negotiate_expires_at,
            // ── Runner-facing settlement metadata (DISPLAY ONLY) ──────────
            // How a job settles changes the runner's decision AND their
            // on-the-ground workflow: on a cash (COD) errand they collect the
            // fare in person and the platform later debits its commission from
            // their wallet (BookingSettlementService::settleCompletion), while a
            // prepaid errand credits their wallet on completion. Neither the
            // method nor the collectible amount was exposed anywhere, so a
            // runner reached dropoff not knowing to ask for money and was then
            // surprised by a negative "commission" wallet entry.
            //
            // Only the METHOD TYPE string is exposed — never gateway refs,
            // payment ids or instrument details (a prior audit deliberately
            // hid gateway_ref). Derived from the `bookings.payment_method`
            // column, the same field the admin screens read.
            'payment_method_type' => $this->when($canSeeRunnerOps, fn () => $this->paymentMethodType()),
            // The same value under the name the customer app reads for the fare
            // line on tracking ("Pay the runner in cash", "Paid with GCash").
            // It was never sent, so that line never showed. The booking's own
            // customer sees it, plus everyone who already sees the type above.
            'payment_method' => $this->when($isOwner || $canSeeRunnerOps, fn () => $this->paymentMethodType()),
            // Peso total the runner must collect from the customer IN PERSON,
            // or null when there is nothing to collect (prepaid, no fronted
            // item cost). Computed from existing columns — it changes no
            // settlement behaviour whatsoever.
            'amount_to_collect' => $this->when($canSeeRunnerOps, fn () => self::amountToCollectFor($this->resource)),
            // Straight-line km from the runner's last known position to this
            // booking's pickup, attached by RunnerErrandController (offer feed
            // + matched offer). Null when the runner has no GPS fix on file, in
            // which case the app's own live figure is the only source.
            'distance_to_pickup_km' => $this->when(
                $canSeeRunnerOps,
                fn () => $this->distance_to_pickup_km !== null
                    ? round((float) $this->distance_to_pickup_km, 1)
                    : null,
            ),
            // The instant the server stops honouring this matched runner's
            // accept (matched_at + matched_acceptance_timeout_seconds — the
            // exact window ExpireStaleMatchesJob enforces). Lets the offer
            // countdown reflect the real window instead of a client guess.
            'accept_deadline' => $this->when(
                $this->status === 'matched' && $this->matched_at !== null,
                fn () => BookingService::matchAcceptDeadline($this->matched_at),
            ),
            // Passenger rides are retired, so this is always false for a new
            // booking. Both flags stay in the payload only because the shipped
            // app reads them; nothing new should branch on either. (The ride
            // PIN itself is no longer served — the shipped app already treats
            // a missing one as "no PIN to show".)
            'is_transportation' => $this->is_transportation,
            'ride_pin_verified' => $this->ride_pin_verified,
            'pickup_photo_url' => $this->when($canSeeContacts, $this->pickup_photo_url),
            'delivery_photo_url' => $this->when($canSeeContacts, $this->delivery_photo_url),
            'signature_url' => $this->when($canSeeContacts, $this->signature_url),
            'matched_at' => $this->matched_at,
            'accepted_at' => $this->accepted_at,
            'picked_up_at' => $this->picked_up_at,
            'completed_at' => $this->completed_at,
            'cancelled_at' => $this->cancelled_at,
            'cancellation_reason' => $this->cancellation_reason,
            // Machine-readable cause, so the app never matches on the wording
            // above: 'payment_not_completed' for a GCash/Maya errand whose
            // payment never arrived; null for any other cancellation (and for
            // older rows).
            'cancellation_code' => $this->cancellation_code,
            'cancellation_fee' => $this->cancellation_fee,
            // Peso amount that came BACK, or null when no money was ever
            // returned on this booking. The fee has always been exposed; the
            // refund it was deducted from was not, so days later a cancelled
            // prepaid errand still showed the full ₱500 total and no trace of
            // the ₱480 that went back — the booking read as money paid for
            // nothing, with the only evidence a wallet ledger row on another
            // screen. 0.0 (not null) is meaningful: money WAS returned-eligible
            // but the capped fee consumed all of it.
            'refunded_amount' => $refundedAmount,
            // Where it landed. Cancels and no-runner refunds credit the
            // ErrandGuy wallet — they are never reversed to the source
            // instrument (BookingController::cancel records refunded_to =
            // 'wallet' on the payment for exactly this reason), and telling
            // the customer to watch their GCash for it would be a lie.
            'refund_destination' => $refundedAmount !== null && $refundedAmount > 0 ? 'wallet' : null,
            'trip_share_active' => $this->trip_share_active,
            'trip_share_token' => $this->when(
                $this->trip_share_active && $this->isParticipant(),
                $this->trip_share_token,
            ),
            // Whether the VIEWER has an open SOS on this booking, so their app
            // can restore its SOS banner after a reload or a poll refresh
            // (CONTRACT-1). Only ever true for the person who pressed it: the
            // other person on the errand is never told (they may be the
            // danger). Admins see the booking-wide flag. Participant/admin-gated.
            'sos_triggered' => $this->when($canSeeContacts, fn (): bool => $this->sosOpenFor($request)),
            'status_logs' => $this->when(
                $this->relationLoaded('statusLogs'),
                fn () => $this->statusLogs->map(fn ($log) => [
                    'status' => $log->status,
                    // Offer notes from before offers stopped naming the runner
                    // ("Runner matched: Juan Dela Cruz") would still show a
                    // customer the name of a runner who never accepted.
                    'note' => str_starts_with((string) $log->note, 'Runner matched: ') ? 'Offered to a runner' : $log->note,
                    'created_at' => $log->created_at,
                ]),
            ),
            'payment' => $this->when(
                $this->relationLoaded('payment') && $this->payment,
                fn () => [
                    'id' => $this->payment->id,
                    'amount' => $this->payment->amount,
                    'method' => $this->payment->method,
                    'status' => $this->payment->status,
                    'paid_at' => $this->payment->paid_at,
                ],
            ),
            // Back-compat: `review` has always meant "the customer's rating of
            // the runner" for existing clients, so keep it pointed there — now
            // resolved deterministically rather than by an unordered hasOne.
            'review' => $this->when(
                $customerReview !== null,
                fn () => new ReviewResource($customerReview),
            ),
            'customer_review' => $this->when(
                $customerReview !== null,
                fn () => new ReviewResource($customerReview),
            ),
            'runner_review' => $this->when(
                $runnerReview !== null,
                fn () => new ReviewResource($runnerReview),
            ),
            'reviews' => $this->when(
                $reviews !== null,
                fn () => ReviewResource::collection($reviews),
            ),
            // True while a GCash/Maya errand waits for its payment: no runner
            // is looked for until it lands, and it is cancelled if it hasn't
            // within BookingService::PAYMENT_WINDOW_MINUTES of booking.
            'awaiting_payment' => $awaitingPayment,
            // The customer's way back into that unfinished payment (the
            // GCash/Maya authorization URL). Owner only, and only while
            // awaiting payment; null otherwise or when there is no open charge.
            'checkout_url' => $awaitingPayment && $isOwner
                ? BookingService::pendingCheckoutUrl($this->resource)
                : null,
            'can_cancel' => in_array($this->status, ['pending', 'matched', 'accepted', 'heading_to_pickup']),
            // Whether POST /bookings/{id}/retry-match would actually be accepted
            // right now. The no-runner recovery screen previously showed a "Try
            // again" button that 409s forever on any prepaid booking (its money
            // is auto-refunded the moment no_runner is set), so the customer
            // tapped a dead end instead of being sent to "Book again". Advisory
            // only — the endpoint re-checks this under a row lock.
            'can_retry_match' => $this->when(
                $isOwner,
                fn () => $viewer->can('retryMatch', $this->resource)
                    && BookingService::customerRetryBlockReason($this->resource) === null,
            ),
            'is_trackable' => in_array($this->status, ['accepted', 'heading_to_pickup', 'arrived_at_pickup', 'picked_up', 'in_transit', 'arrived_at_dropoff', 'delivered']),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }

    /**
     * Settlement method type for runner-facing screens: 'cash' | 'wallet' |
     * 'gcash' | 'maya' ('card' on older bookings, from before cards were
     * retired).
     * Reads the booking column the admin screens read, falling back to the
     * payment row's method only when that relation is already loaded (never
     * triggers an extra query).
     */
    protected function paymentMethodType(): ?string
    {
        if ($this->payment_method) {
            return $this->payment_method;
        }

        return $this->relationLoaded('payment') ? $this->payment?->method : null;
    }

    /**
     * Peso amount the runner must collect from the customer in person, or null
     * when there is nothing to collect. Two independent components:
     *
     *  1. FARE — owed in cash only when the booking's method IS cash and it has
     *     not already settled. `total_amount` is exactly what the cash branch of
     *     settleCompletion assumes was collected (commission = total − payout), so
     *     this figure and the ledger cannot disagree. An online booking that has
     *     not settled yet deliberately reports NO fare: the runner must never be
     *     told to collect cash on a GCash/card/wallet job.
     *  2. FRONTED ITEM COST — `actual_item_cost` (what the runner actually paid
     *     at the store, capped at the customer's shopping_budget spending
     *     limit). Item money never enters `total_amount` and is never charged
     *     online, so the runner is out of pocket until the customer repays them
     *     in cash at the door — on prepaid errands too. Only counted once the
     *     runner has REPORTED it (the budget is a ceiling, not an amount).
     *
     * Nothing is left to collect once the errand is completed: completion is
     * the runner confirming the handover, cash included. A cash booking keeps
     * payment_status 'unpaid' after settlement, so without this a finished cash
     * errand went on saying "Collect ₱X". Before completion nothing changes —
     * the no-signature rule (UpdateErrandStatusRequest) still sees money due.
     *
     * Static so the realtime offer (IncomingRequest) sends the same figure.
     */
    public static function amountToCollectFor(Booking $booking): ?float
    {
        if ($booking->status === 'completed') {
            return null;
        }

        $fareDue = ($booking->payment_method === 'cash' && $booking->payment_status !== 'paid')
            ? (float) $booking->total_amount
            : 0.0;

        $itemsDue = max(0.0, (float) ($booking->actual_item_cost ?? 0));

        $total = round($fareDue + $itemsDue, 2);

        return $total > 0 ? $total : null;
    }

    /**
     * Peso amount returned to the customer on this booking, or null when no
     * money was ever given back.
     *
     * Read off the booking's own columns — the SAME arithmetic
     * BookingController::cancel uses to build its receipt message (total −
     * the fee actually recorded, gated on payment_status having flipped to
     * 'refunded'), so the receipt the customer saw at cancel time and the
     * receipt they open a week later can never disagree. Deliberately not
     * recomputed from a policy tier: the recorded fee is capped/zeroed
     * (PRICE-3 / PRICE-4) and a fresh tier computation would print a phantom
     * charge.
     */
    protected function refundedAmount(): ?float
    {
        if ($this->payment_status !== 'refunded') {
            return null;
        }

        return round(
            max(0, (float) $this->total_amount - (float) $this->cancellation_fee),
            2,
        );
    }

    /**
     * Whether the viewer may see an open SOS on this booking: an admin sees
     * the booking flag; a participant only an alert they raised themselves.
     * Queries only when the booking flag is set (rare).
     */
    protected function sosOpenFor(Request $request): bool
    {
        if (! $this->sos_triggered) {
            return false;
        }

        $viewer = $request->user();
        if ($viewer instanceof AdminUser) {
            return true;
        }

        return $viewer !== null && SOSAlert::where('booking_id', $this->id)
            ->where('triggered_by', $viewer->id)
            ->where('status', SOSAlert::STATUS_ACTIVE)
            ->exists();
    }

    /**
     * Check if the current authenticated user is a participant of this booking.
     */
    protected function isParticipant(): bool
    {
        $user = request()->user();
        if (! $user) {
            return false;
        }

        return $user->id === $this->customer_id || $user->id === $this->runner_id;
    }
}
