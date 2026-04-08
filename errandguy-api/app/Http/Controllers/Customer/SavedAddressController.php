<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Requests\SavedAddressRequest;
use App\Models\SavedAddress;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SavedAddressController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $addresses = $request->user()
            ->savedAddresses()
            ->orderByDesc('is_default')
            ->orderBy('label')
            ->get();

        return response()->json([
            'data' => $addresses,
        ]);
    }

    public function store(SavedAddressRequest $request): JsonResponse
    {
        $user = $request->user();

        // Enforce max 10 addresses
        if ($user->savedAddresses()->count() >= 10) {
            return response()->json([
                'message' => 'Maximum of 10 saved addresses reached.',
            ], 422);
        }

        $data = $request->validated();

        // If marking as default, unset other defaults
        if (!empty($data['is_default'])) {
            $user->savedAddresses()->update(['is_default' => false]);
        }

        $address = $user->savedAddresses()->create($data);

        return response()->json([
            'data' => $address,
            'message' => 'Address saved successfully.',
        ], 201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $address = SavedAddress::findOrFail($id);

        $this->authorize('delete', $address);

        $address->delete();

        return response()->json([
            'message' => 'Address deleted successfully.',
        ]);
    }
}
