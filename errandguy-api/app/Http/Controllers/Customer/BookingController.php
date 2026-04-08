<?php

namespace App\Http\Controllers\Customer;

use App\Events\BookingCancelled;
use App\Events\BookingCreated;
use App\Http\Controllers\Controller;
use App\Http\Requests\Booking\CancelBookingRequest;
use App\Http\Requests\Booking\CreateBookingRequest;
use App\Http\Requests\Booking\EstimateRequest;
use App\Http\Resources\BookingResource;
use App\Jobs\BroadcastToRunnersJob;
use App\Jobs\MatchRunnerJob;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\ErrandType;
use App\Models\RunnerLocation;
use App\Services\PricingService;
use App\Services\PromoService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class BookingController extends Controller
{
    public function __construct(
        private PricingService $pricingService,
        private PromoService $promoService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = $request->user()
            ->customerBookings()
            ->with(['errandType', 'runner', 'review'])
            ->orderByDesc('created_at');

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }

        if ($request->filled('errand_type_id')) {
            $query->where('errand_type_id', $request->input('errand_type_id'));
        }

        if ($request->filled('date_from')) {
            $query->whereDate('created_at', '>=', $request->input('date_from'));
        }

        if ($request->filled('date_to')) {
            $query->whereDate('created_at', '<=', $request->input('date_to'));
        }

        $bookings = $query->paginate($request->integer('per_page', 15));

        return response()->json(
            BookingResource::collection($bookings)->response()->getData(true)
        );
    }

    public function store(CreateBookingRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $user = $request->user();
        $errandType = ErrandType::findOrFail($validated['errand_type_id']);

        // Calculate pricing
        $vehicleType = $validated['vehicle_type_rate'] ?? 'motorcycle';
        $pricing = $this->pricingService->calculate(
            $validated['errand_type_id'],
            $validated['pickup_lat'],
            $validated['pickup_lng'],
            $validated['dropoff_lat'],
            $validated['dropoff_lng'],
            $vehicleType,
            $validated['schedule_type']
        );

        // Handle promo code
        $promoDiscount = 0;
        $promoCodeId = null;
        if (!empty($validated['promo_code'])) {
            try {
                $promo = $this->promoService->validate(
                    $validated['promo_code'],
                    $user->id,
                    $pricing['total_amount']
                );
                $promoDiscount = $promo['discount'];
                $promoCodeId = $promo['id'];
            } catch (\InvalidArgumentException $e) {
                return response()->json(['message' => $e->getMessage()], 422);
            }
        }

        // Determine if transportation
        $isTransportation = $errandType->slug === 'transportation';

        // Generate booking number: EG-YYYYMMDD-XXXX
        $bookingNumber = 'EG-' . now()->format('Ymd') . '-' . strtoupper(Str::random(4));

        // Generate ride PIN for transportation
        $ridePin = $isTransportation ? str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT) : null;

        $booking = Booking::create([
            'booking_number' => $bookingNumber,
            'customer_id' => $user->id,
            'errand_type_id' => $validated['errand_type_id'],
            'status' => 'pending',
            'pickup_address' => $validated['pickup_address'],
            'pickup_lat' => $validated['pickup_lat'],
            'pickup_lng' => $validated['pickup_lng'],
            'pickup_contact_name' => $validated['pickup_contact_name'] ?? null,
            'pickup_contact_phone' => $validated['pickup_contact_phone'] ?? null,
            'dropoff_address' => $validated['dropoff_address'],
            'dropoff_lat' => $validated['dropoff_lat'],
            'dropoff_lng' => $validated['dropoff_lng'],
            'dropoff_contact_name' => $validated['dropoff_contact_name'] ?? null,
            'dropoff_contact_phone' => $validated['dropoff_contact_phone'] ?? null,
            'description' => $validated['description'] ?? null,
            'special_instructions' => $validated['special_instructions'] ?? null,
            'estimated_item_value' => $validated['estimated_item_value'] ?? null,
            'schedule_type' => $validated['schedule_type'],
            'scheduled_at' => $validated['scheduled_at'] ?? null,
            'pricing_mode' => $validated['pricing_mode'],
            'vehicle_type_rate' => $vehicleType,
            'distance_km' => $pricing['distance_km'],
            'base_fee' => $pricing['base_fee'],
            'distance_fee' => $pricing['distance_fee'],
            'service_fee' => $pricing['service_fee'],
            'surcharge' => $pricing['surcharge'],
            'promo_discount' => $promoDiscount,
            'total_amount' => $pricing['total_amount'] - $promoDiscount,
            'customer_offer' => $validated['customer_offer'] ?? null,
            'runner_payout' => $pricing['runner_payout'],
            'promo_code_id' => $promoCodeId,
            'ride_pin' => $ridePin,
            'is_transportation' => $isTransportation,
        ]);

        // Handle item photos upload
        if ($request->hasFile('item_photos')) {
            $photos = [];
            foreach ($request->file('item_photos') as $photo) {
                $path = $photo->store('booking-photos/' . $booking->id, 'public');
                $photos[] = \Illuminate\Support\Facades\Storage::disk('public')->url($path);
            }
            $booking->update(['item_photos' => $photos]);
        }

        // Create initial status log
        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'pending',
            'changed_by' => $user->id,
            'note' => 'Booking created',
        ]);

        // Redeem promo if used
        if ($promoCodeId) {
            $this->promoService->redeem($promoCodeId, $booking->id);
        }

        // Dispatch matching job based on pricing mode
        if ($validated['pricing_mode'] === 'fixed') {
            MatchRunnerJob::dispatch($booking->id);
        } else {
            BroadcastToRunnersJob::dispatch($booking->id);
        }

        // Fire booking created event
        event(new BookingCreated($booking));

        $booking->load(['errandType', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => 'Booking created successfully.',
        ], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $booking = Booking::with(['errandType', 'runner', 'statusLogs', 'payment', 'review'])
            ->findOrFail($id);

        $this->authorize('view', $booking);

        return response()->json([
            'data' => new BookingResource($booking),
        ]);
    }

    public function cancel(CancelBookingRequest $request, string $id): JsonResponse
    {
        $booking = Booking::findOrFail($id);

        $this->authorize('cancel', $booking);

        // Check booking is in a cancellable state
        if (!in_array($booking->status, ['pending', 'matched', 'accepted'])) {
            return response()->json([
                'message' => 'This booking can no longer be cancelled.',
            ], 422);
        }

        $booking->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'cancelled_by' => $request->user()->id,
            'cancellation_reason' => $request->validated('reason'),
        ]);

        BookingStatusLog::create([
            'booking_id' => $booking->id,
            'status' => 'cancelled',
            'changed_by' => $request->user()->id,
            'note' => $request->validated('reason'),
        ]);

        event(new BookingCancelled($booking));

        $booking->load(['errandType', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($booking),
            'message' => 'Booking cancelled successfully.',
        ]);
    }

    public function track(Request $request, string $id): JsonResponse
    {
        $booking = Booking::with(['errandType', 'runner', 'statusLogs'])
            ->findOrFail($id);

        $this->authorize('track', $booking);

        $latestLocation = null;
        if ($booking->runner_id) {
            $latestLocation = RunnerLocation::where('booking_id', $booking->id)
                ->where('runner_id', $booking->runner_id)
                ->orderByDesc('created_at')
                ->first();
        }

        return response()->json([
            'data' => [
                'booking' => new BookingResource($booking),
                'runner_location' => $latestLocation ? [
                    'lat' => $latestLocation->lat,
                    'lng' => $latestLocation->lng,
                    'heading' => $latestLocation->heading,
                    'speed' => $latestLocation->speed,
                    'updated_at' => $latestLocation->created_at,
                ] : null,
            ],
        ]);
    }

    public function active(Request $request): JsonResponse
    {
        $booking = $request->user()
            ->customerBookings()
            ->with(['errandType', 'runner', 'statusLogs'])
            ->active()
            ->orderByDesc('created_at')
            ->first();

        return response()->json([
            'data' => $booking ? new BookingResource($booking) : null,
        ]);
    }

    public function estimate(EstimateRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $estimates = $this->pricingService->estimate(
            $validated['errand_type_id'],
            $validated['pickup_lat'],
            $validated['pickup_lng'],
            $validated['dropoff_lat'],
            $validated['dropoff_lng']
        );

        return response()->json([
            'data' => $estimates,
        ]);
    }

    public function rebook(Request $request, string $id): JsonResponse
    {
        $original = Booking::findOrFail($id);

        $this->authorize('view', $original);

        // Recalculate pricing with current rates
        $vehicleType = $original->vehicle_type_rate ?? 'motorcycle';
        $pricing = $this->pricingService->calculate(
            $original->errand_type_id,
            $original->pickup_lat,
            $original->pickup_lng,
            $original->dropoff_lat,
            $original->dropoff_lng,
            $vehicleType
        );

        $bookingNumber = 'EG-' . now()->format('Ymd') . '-' . strtoupper(Str::random(4));
        $ridePin = $original->is_transportation ? str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT) : null;

        $newBooking = Booking::create([
            'booking_number' => $bookingNumber,
            'customer_id' => $request->user()->id,
            'errand_type_id' => $original->errand_type_id,
            'status' => 'pending',
            'pickup_address' => $original->pickup_address,
            'pickup_lat' => $original->pickup_lat,
            'pickup_lng' => $original->pickup_lng,
            'pickup_contact_name' => $original->pickup_contact_name,
            'pickup_contact_phone' => $original->pickup_contact_phone,
            'dropoff_address' => $original->dropoff_address,
            'dropoff_lat' => $original->dropoff_lat,
            'dropoff_lng' => $original->dropoff_lng,
            'dropoff_contact_name' => $original->dropoff_contact_name,
            'dropoff_contact_phone' => $original->dropoff_contact_phone,
            'description' => $original->description,
            'special_instructions' => $original->special_instructions,
            'estimated_item_value' => $original->estimated_item_value,
            'schedule_type' => 'now',
            'pricing_mode' => $original->pricing_mode,
            'vehicle_type_rate' => $vehicleType,
            'distance_km' => $pricing['distance_km'],
            'base_fee' => $pricing['base_fee'],
            'distance_fee' => $pricing['distance_fee'],
            'service_fee' => $pricing['service_fee'],
            'surcharge' => $pricing['surcharge'],
            'total_amount' => $pricing['total_amount'],
            'runner_payout' => $pricing['runner_payout'],
            'ride_pin' => $ridePin,
            'is_transportation' => $original->is_transportation,
        ]);

        BookingStatusLog::create([
            'booking_id' => $newBooking->id,
            'status' => 'pending',
            'changed_by' => $request->user()->id,
            'note' => 'Rebooked from ' . $original->booking_number,
        ]);

        MatchRunnerJob::dispatch($newBooking->id);
        event(new BookingCreated($newBooking));

        $newBooking->load(['errandType', 'statusLogs']);

        return response()->json([
            'data' => new BookingResource($newBooking),
            'message' => 'Booking rebooked successfully.',
        ], 201);
    }
}
