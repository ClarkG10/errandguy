<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RunnerDocumentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            // Legacy public URL (null for new private docs). Kept for back-compat.
            'file_url' => $this->file_url,
            // Owner-authorized stream of the private KYC file. The app attaches
            // its bearer token only to /internal/runner-documents/ image loads,
            // so this must be that route (the /api/v1/runner/documents/{id}/file
            // twin got no token and always answered 403). Relative, so the app
            // anchors it on the API host it already uses — an absolute URL
            // built behind the proxy can come out as http:// and lose the token
            // on the redirect to https.
            'download_url' => route('admin.runner-documents.file', $this->resource, false),
            'status' => $this->status,
            'rejection_reason' => $this->rejection_reason,
            'created_at' => $this->created_at,
        ];
    }
}
