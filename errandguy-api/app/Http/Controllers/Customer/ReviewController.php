<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Booking\ReviewRequest;
use App\Http\Resources\ReviewResource;
use App\Models\Booking;
use App\Models\Review;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReviewController extends Controller
{
    public function store(ReviewRequest $request, string $bookingId): JsonResponse
    {
        $booking = Booking::findOrFail($bookingId);

        $this->authorize('review', $booking);

        // Check booking is completed
        if ($booking->status !== 'completed') {
            return $this->fail(ErrorCode::BOOKING_STATE_INVALID, 'You can only review completed bookings.', 422);
        }

        $reviewerId = $request->user()->id;

        // Determine the reviewee from the reviewer's role on this booking.
        // Customer-as-reviewer rates the runner; runner-as-reviewer rates
        // the customer. Anything else was already blocked by the policy.
        if ($reviewerId === $booking->customer_id) {
            $revieweeId = $booking->runner_id;
        } elseif ($reviewerId === $booking->runner_id) {
            $revieweeId = $booking->customer_id;
        } else {
            return $this->fail(ErrorCode::FORBIDDEN, 'You are not a participant of this booking.', 403);
        }

        if (!$revieweeId) {
            return $this->fail(ErrorCode::BOOKING_STATE_INVALID, 'No counter-party to review on this booking.', 422);
        }

        // Check no existing review from this reviewer
        $existingReview = Review::where('booking_id', $booking->id)
            ->where('reviewer_id', $reviewerId)
            ->exists();

        if ($existingReview) {
            // 422 on purpose: the app treats a repeat review as already done
            // (an offline replay lands here). The code says why.
            return $this->fail(ErrorCode::CONFLICT, 'You have already reviewed this booking.', 422);
        }

        // Creating the review recomputes the reviewee's average under a lock on
        // their row, in the same transaction (Review::refreshRatingFor).
        $review = DB::transaction(fn () => Review::create([
            'booking_id' => $booking->id,
            'reviewer_id' => $reviewerId,
            'reviewee_id' => $revieweeId,
            'rating' => $request->validated('rating'),
            'comment' => $request->validated('comment'),
        ]));

        $review->load('reviewer');

        return response()->json([
            'data' => new ReviewResource($review),
            'message' => 'Review submitted successfully.',
        ], 201);
    }
}
