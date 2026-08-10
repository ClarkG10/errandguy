<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Models\RunnerDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Authenticated serving of runner KYC documents (SEC-1). New documents live on
 * the PRIVATE disk and are never publicly reachable; they are streamed only to:
 *   - the OWNING runner (Sanctum, role:runner) via show(); and
 *   - an admin (session `auth:admin`, i.e. the Filament panel) via showForAdmin().
 * Legacy pre-SEC-1 documents (still on the public disk) are streamed through the
 * same code path so the switch is backward-compatible.
 */
class RunnerDocumentFileController extends Controller
{
    /** Owning runner views their own document (mobile app, Sanctum bearer). */
    public function show(Request $request, RunnerDocument $document): StreamedResponse
    {
        abort_unless(
            $document->runnerProfile && $document->runnerProfile->user_id === $request->user()->id,
            403,
        );

        return $this->streamDocument($document);
    }

    /** Admin views any runner's document (Filament, session `auth:admin`). */
    public function showForAdmin(RunnerDocument $document): StreamedResponse
    {
        return $this->streamDocument($document);
    }

    private function streamDocument(RunnerDocument $document): StreamedResponse
    {
        // New uploads: private disk.
        if ($document->file_path && Storage::disk('local')->exists($document->file_path)) {
            return Storage::disk('local')->response($document->file_path);
        }

        // Legacy uploads: still on the public disk (pre-SEC-1). Serve them
        // through this authenticated route too so behaviour is uniform.
        if ($document->file_url) {
            $legacyPath = str_replace(Storage::disk('public')->url(''), '', $document->file_url);
            if (Storage::disk('public')->exists($legacyPath)) {
                return Storage::disk('public')->response($legacyPath);
            }
        }

        abort(404);
    }
}
