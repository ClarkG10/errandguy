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

        // Check no existing review from this customer
        $existingReview = Review::where('booking_id', $booking->id)
            ->where('reviewer_id', $request->user()->id)
            ->exists();

        if ($existingReview) {
            return response()->json([
                'message' => 'You have already reviewed this booking.',
            ], 422);
        }

        $review = DB::transaction(function () use ($booking, $request) {
            $review = Review::create([
                'booking_id' => $booking->id,
                'reviewer_id' => $request->user()->id,
                'reviewee_id' => $booking->runner_id,
                'rating' => $request->validated('rating'),
                'comment' => $request->validated('comment'),
            ]);

            // Update runner's average rating atomically (lock runner row during aggregation)
            if ($booking->runner_id) {
                $runner = User::where('id', $booking->runner_id)
                    ->lockForUpdate()
                    ->first();

                if ($runner) {
                    $stats = Review::where('reviewee_id', $runner->id)
                        ->selectRaw('AVG(rating) as avg_rating, COUNT(*) as total_ratings')
                        ->first();

                    $runner->update([
                        'avg_rating' => round($stats->avg_rating, 2),
                        'total_ratings' => $stats->total_ratings,
                    ]);
                }
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
