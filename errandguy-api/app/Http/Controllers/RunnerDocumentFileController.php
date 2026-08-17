<?php

namespace App\Http\Controllers;

use App\Models\RunnerDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Streams runner KYC documents. The files live on the PRIVATE 'kyc' disk and are
 * never web-served directly — every read goes through one of these authorized
 * endpoints (a government ID must not be reachable by URL alone).
 */
class RunnerDocumentFileController extends Controller
{
    /**
     * Stream to an authenticated ADMIN (Filament session guard). Used by the
     * admin panel's document viewer, whose <img>/link loads carry the admin
     * session cookie.
     */
    public function adminShow(RunnerDocument $document)
    {
        abort_unless(auth('admin')->check(), 403);

        return $this->stream($document);
    }

    /**
     * Stream a runner's OWN document (sanctum). A runner can only read documents
     * attached to their own runner profile.
     */
    public function ownerShow(Request $request, RunnerDocument $document)
    {
        $profile = $request->user()?->runnerProfile;

        abort_unless($profile !== null && $document->runner_id === $profile->id, 403);

        return $this->stream($document);
    }

    private function stream(RunnerDocument $document)
    {
        // New docs: private kyc disk. Harden the response — nosniff (a
        // government ID must never be MIME-sniffed into executable content) and
        // no-store (keep it out of any intermediary cache). This route is on the
        // `web` group and so doesn't inherit the api SecurityHeaders middleware.
        if (filled($document->file_path) && Storage::disk('kyc')->exists($document->file_path)) {
            return Storage::disk('kyc')->response($document->file_path, null, [
                'X-Content-Type-Options' => 'nosniff',
                'Cache-Control' => 'private, no-store, max-age=0',
            ]);
        }

        // Legacy docs still on the old public disk (pre-migration). Redirect to
        // their public URL until the one-time file move backfills file_path.
        if (filled($document->file_url)) {
            return redirect()->away($document->file_url);
        }

        abort(404);
    }
}
