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
            // Delete the old file from wherever it lives — the private kyc disk
            // (new) or, for a legacy row, the old public disk.
            if ($existing->file_path) {
                Storage::disk('kyc')->delete($existing->file_path);
            } elseif ($existing->file_url) {
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
        // Unguessable filename: the directory is keyed on the runner's user id
        // (a past customer may know it) + the document type (a tiny enum), so a
        // 40-char CSPRNG token removes any enumeration vector.
        $filename = $timestamp . '_' . \Illuminate\Support\Str::random(40) . '.' . $extension;

        // PRIVATE 'kyc' disk — a government ID must never be a web-served public
        // URL. The file is retrievable only through the authorized admin/owner
        // streaming routes (RunnerDocumentFileController); we persist the disk
        // path, not a URL. (audit: KYC docs were on the public disk)
        $path = $file->storeAs(
            "runner-documents/{$request->user()->id}/{$documentType}",
            $filename,
            'kyc'
        );

        $document = RunnerDocument::create([
            'runner_id' => $profile->id,
            'document_type' => $documentType,
            'file_path' => $path,
            'file_url' => null,
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
