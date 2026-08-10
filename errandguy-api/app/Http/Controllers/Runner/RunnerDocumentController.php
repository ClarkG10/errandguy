<?php

namespace App\Http\Controllers\Runner;

use App\Http\Controllers\Controller;
use App\Http\Requests\Runner\UploadDocumentRequest;
use App\Http\Resources\RunnerDocumentResource;
use App\Models\Notification;
use App\Models\RunnerDocument;
use App\Models\RunnerProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

class RunnerDocumentController extends Controller
{
    public function store(UploadDocumentRequest $request): JsonResponse
    {
        $profile = $request->user()->runnerProfile;

        if (!$profile) {
            $profile = RunnerProfile::create([
                'user_id' => $request->user()->id,
                'verification_status' => 'pending',
            ]);
        }

        $validated = $request->validated();
        $file = $request->file('file');
        $documentType = $validated['document_type'];

        // Check if same type document exists and was rejected — replace it
        $existing = RunnerDocument::where('runner_id', $profile->id)
            ->where('document_type', $documentType)
            ->first();

        if ($existing && $existing->status === 'rejected') {
            // Delete old file
            if ($existing->file_url) {
                Storage::disk('public')->delete(
                    str_replace(Storage::disk('public')->url(''), '', $existing->file_url)
                );
            }
            $existing->delete();
        } elseif ($existing && $existing->status !== 'rejected') {
            return response()->json([
                'message' => 'A document of this type is already submitted and pending/approved.',
            ], 422);
        }

        // Upload file — use guessExtension() for MIME-based extension (not client-supplied)
        $timestamp = now()->format('YmdHis');
        $extension = $file->guessExtension() ?? $file->getClientOriginalExtension();
        // Unguessable filename (SEC-1). The directory is keyed on the runner's
        // user id — which a past customer may already know — and the document
        // type (a tiny enum), and a bare timestamp is guessable; together that
        // let the public-disk URL of a government ID be brute-forced. A 40-char
        // CSPRNG token removes the enumeration vector. NOTE: the file still lives
        // on the PUBLIC disk — fully closing SEC-1 means moving KYC docs to a
        // private disk served via signed/authenticated URLs, which also requires
        // switching the admin Filament + mobile display off the raw public URL
        // (tracked separately).
        $filename = $timestamp . '_' . \Illuminate\Support\Str::random(40) . '.' . $extension;
        $path = $file->storeAs(
            "runner-documents/{$request->user()->id}/{$documentType}",
            $filename,
            'public'
        );
        $fileUrl = Storage::disk('public')->url($path);

        $document = RunnerDocument::create([
            'runner_id' => $profile->id,
            'document_type' => $documentType,
            'file_url' => $fileUrl,
            'status' => 'pending',
        ]);

        // Notify admins of new submission
        Notification::create([
            'user_id' => $request->user()->id,
            'title' => 'Document Submitted',
            'body' => "Your {$documentType} document has been submitted for review.",
            'type' => 'document_update',
            'data' => ['document_id' => $document->id],
        ]);

        return response()->json([
            'data' => new RunnerDocumentResource($document),
            'message' => 'Document uploaded successfully.',
        ], 201);
    }
}
