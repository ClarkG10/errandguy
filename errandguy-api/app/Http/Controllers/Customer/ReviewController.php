<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Booking\ReviewRequest;
use App\Http\Resources\ReviewResource;
use App\Models\Booking;
use App\Models\Review;
use App\Models\User;
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
            return response()->json([
                'message' => 'You can only review completed bookings.',
            ], 422);
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
            return response()->json([
                'message' => 'You are not a participant of this booking.',
            ], 403);
        }

        if (!$revieweeId) {
            return response()->json([
                'message' => 'No counter-party to review on this booking.',
            ], 422);
        }

        // Check no existing review from this reviewer
        $existingReview = Review::where('booking_id', $booking->id)
            ->where('reviewer_id', $reviewerId)
            ->exists();

        if ($existingReview) {
            return response()->json([
                'message' => 'You have already reviewed this booking.',
            ], 422);
        }

        $review = DB::transaction(function () use ($booking, $request, $reviewerId, $revieweeId) {
            $review = Review::create([
                'booking_id' => $booking->id,
                'reviewer_id' => $reviewerId,
                'reviewee_id' => $revieweeId,
                'rating' => $request->validated('rating'),
                'comment' => $request->validated('comment'),
            ]);

            // Recompute the reviewee's average rating atomically.
            $reviewee = User::where('id', $revieweeId)
                ->lockForUpdate()
                ->first();

            if ($reviewee) {
                $stats = Review::where('reviewee_id', $reviewee->id)
                    ->selectRaw('AVG(rating) as avg_rating, COUNT(*) as total_ratings')
                    ->first();

                $reviewee->update([
                    'avg_rating' => round($stats->avg_rating, 2),
                    'total_ratings' => $stats->total_ratings,
                ]);
            }

            return $review;
        });

        $review->load('reviewer');

        return response()->json([
            'data' => new ReviewResource($review),
            'message' => 'Review submitted successfully.',
        ], 201);
    }
}
