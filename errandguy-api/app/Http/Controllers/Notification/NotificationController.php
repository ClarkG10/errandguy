<?php

namespace App\Http\Controllers\Notification;

use App\Http\Controllers\Controller;
use App\Http\Resources\NotificationResource;
use App\Models\Notification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'types' => ['nullable', 'string', 'max:300'],
        ]);

        $query = Notification::where('user_id', $request->user()->id);

        // Default view excludes archived notifications; `?archived=1`
        // returns the archived set only.
        if ($request->boolean('archived')) {
            $query->archived();
        } else {
            $query->active();
        }

        // Category filtering happens HERE, not in the client.
        //
        // The app's inbox chips ("Bookings", "Payments", "Promos", "More") are
        // coarse groupings over several `type` values, and they used to filter
        // the rows already loaded — page one only. So a customer with a busy
        // inbox could tap "Payments" and be told "No payment notifications
        // yet" while their payment rows sat unfetched on page three. Filtering
        // server-side makes the chip mean what it says and keeps pagination
        // correct within a selected category.
        //
        // Comma-separated so one round trip covers a whole group. Unknown
        // values are simply ignored rather than rejected: a newer client
        // sending a type this build has never heard of should get a narrower
        // list, not a validation error.
        if ($request->filled('types')) {
            $types = collect(explode(',', (string) $request->input('types')))
                ->map(fn (string $t) => trim($t))
                ->filter()
                ->unique()
                ->take(20)
                ->all();

            if ($types !== []) {
                $query->whereIn('type', $types);
            }
        }

        $notifications = $query
            ->orderByDesc('created_at')
            ->paginate($request->perPage(20));

        return response()->json(
            NotificationResource::collection($notifications)->response()->getData(true)
        );
    }

    public function unreadCount(Request $request): JsonResponse
    {
        // ->active() (archived_at IS NULL) to match the inbox default — an
        // archived-but-unread notification is unreachable in every list the user
        // can open, so counting it left a phantom badge that could never be
        // cleared by tapping (only by "mark all read").
        $count = Notification::where('user_id', $request->user()->id)
            ->active()
            ->unread()
            ->count();

        return response()->json([
            'data' => ['unread_count' => $count],
        ]);
    }

    public function markAsRead(Request $request, string $id): JsonResponse
    {
        $notification = Notification::where('user_id', $request->user()->id)
            ->findOrFail($id);

        $notification->update(['is_read' => true]);

        return response()->json([
            'message' => 'Notification marked as read.',
        ]);
    }

    public function markAllAsRead(Request $request): JsonResponse
    {
        Notification::where('user_id', $request->user()->id)
            ->unread()
            ->update(['is_read' => true]);

        return response()->json([
            'message' => 'All notifications marked as read.',
        ]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $notification = Notification::where('user_id', $request->user()->id)
            ->findOrFail($id);

        $notification->delete();

        return response()->json([
            'message' => 'Notification deleted.',
        ]);
    }

    public function archive(Request $request, string $id): JsonResponse
    {
        $notification = Notification::where('user_id', $request->user()->id)
            ->findOrFail($id);

        $notification->update(['archived_at' => now()]);

        return response()->json([
            'message' => 'Notification archived.',
        ]);
    }

    public function unarchive(Request $request, string $id): JsonResponse
    {
        $notification = Notification::where('user_id', $request->user()->id)
            ->findOrFail($id);

        $notification->update(['archived_at' => null]);

        return response()->json([
            'message' => 'Notification unarchived.',
        ]);
    }

    public function clearAll(Request $request): JsonResponse
    {
        $count = Notification::where('user_id', $request->user()->id)->delete();

        return response()->json([
            'message' => 'Notifications cleared.',
            'data' => ['deleted_count' => $count],
        ]);
    }
}
