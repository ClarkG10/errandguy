<?php

namespace App\Http\Controllers\Customer;

use App\Http\Controllers\Controller;
use App\Http\Requests\TrustedContactRequest;
use App\Models\TrustedContact;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TrustedContactController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $contacts = $request->user()
            ->trustedContacts()
            ->orderBy('priority')
            ->get();

        return response()->json([
            'data' => $contacts,
        ]);
    }

    public function store(TrustedContactRequest $request): JsonResponse
    {
        $user = $request->user();

        // Enforce max 5 contacts
        if ($user->trustedContacts()->count() >= 5) {
            return response()->json([
                'message' => 'Maximum of 5 trusted contacts reached.',
            ], 422);
        }

        $contact = $user->trustedContacts()->create($request->validated());

        return response()->json([
            'data' => $contact,
            'message' => 'Trusted contact added successfully.',
        ], 201);
    }

    public function update(TrustedContactRequest $request, string $id): JsonResponse
    {
        $contact = TrustedContact::findOrFail($id);

        $this->authorize('update', $contact);

        $contact->update($request->validated());

        return response()->json([
            'data' => $contact->fresh(),
            'message' => 'Trusted contact updated successfully.',
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $contact = TrustedContact::findOrFail($id);

        $this->authorize('delete', $contact);

        $contact->delete();

        return response()->json([
            'message' => 'Trusted contact deleted successfully.',
        ]);
    }
}
