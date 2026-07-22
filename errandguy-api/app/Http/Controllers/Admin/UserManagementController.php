<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserManagementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = User::query();

        if ($role = $request->query('role')) {
            $query->where('role', $role);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('full_name', 'ilike', "%{$search}%")
                  ->orWhere('email', 'ilike', "%{$search}%")
                  ->orWhere('phone', 'ilike', "%{$search}%");
            });
        }

        if ($request->query('status') === 'suspended') {
            $query->where('status', 'suspended');
        }

        $users = $query->orderByDesc('created_at')->paginate(20);

        return response()->json($users);
    }

    public function show(string $id): JsonResponse
    {
        $user = User::with(['runnerProfile', 'runnerDocuments'])->findOrFail($id);

        return response()->json(['data' => $user]);
    }

    public function suspend(Request $request, string $id): JsonResponse
    {
        $request->validate(['reason' => 'required|string|max:500']);

        $user = User::findOrFail($id);

        // Enforcement (EnsureUserActive middleware + LoginController) keys on
        // `status`, NOT the previously-written `is_active` column — which did
        // not exist, so mass-assignment silently discarded it and the account
        // stayed fully active. Write the real column.
        $user->update([
            'status' => 'suspended',
            'suspended_reason' => $request->input('reason'),
            'suspended_at' => now(),
        ]);

        // Cut any already-authenticated session immediately, otherwise a
        // suspended user with a live bearer token keeps transacting until it
        // expires.
        $user->tokens()->delete();

        return response()->json(['message' => 'User suspended']);
    }

    public function unsuspend(string $id): JsonResponse
    {
        $user = User::findOrFail($id);
        $user->update([
            'status' => 'active',
            'suspended_reason' => null,
            'suspended_at' => null,
        ]);

        return response()->json(['message' => 'User reactivated']);
    }
}
