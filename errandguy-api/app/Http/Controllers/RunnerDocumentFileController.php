<?php

namespace App\Http\Controllers;

use App\Models\RunnerDocument;
use App\Models\User;
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
     * GET /internal/runner-documents/{document}/file — the one URL both sides
     * load a KYC document from:
     *
     *   - an ADMIN through the panel's admin session cookie (moderation roles
     *     only — super_admin/admin/ops; finance/support have no verification
     *     duty and must not see runners' government IDs / selfies);
     *   - the RUNNER who uploaded it, with their app login (sanctum bearer).
     *     The app attaches its bearer token to /internal/runner-documents/
     *     image loads (and only those), which is why RunnerDocumentResource
     *     hands out this URL as download_url.
     *
     * This is the AUTHORITATIVE gate: the Filament Documents tab and
     * relation-manager visibility are cosmetic; this route serves the bytes.
     */
    public function adminShow(RunnerDocument $document)
    {
        $isModerator = auth('admin')->user()?->canModerate() ?? false;

        if (! $isModerator) {
            $user = auth('sanctum')->user();
            abort_unless($user instanceof User && $this->owns($user, $document), 403);
        }

        return $this->stream($document);
    }

    /**
     * Stream a runner's OWN document (sanctum). A runner can only read documents
     * attached to their own runner profile.
     */
    public function ownerShow(Request $request, RunnerDocument $document)
    {
        $user = $request->user();

        abort_unless($user instanceof User && $this->owns($user, $document), 403);

        return $this->stream($document);
    }

    private function owns(User $user, RunnerDocument $document): bool
    {
        $profile = $user->runnerProfile;

        return $profile !== null && $document->runner_id === $profile->id;
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
