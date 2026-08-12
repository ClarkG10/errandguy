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
            // Owner-authorized stream of the private KYC file — the app should
            // load this WITH its bearer token (an <Image> with auth headers),
            // not the raw file_url. (audit KYC)
            'download_url' => route('runner.documents.file', $this->resource),
            'status' => $this->status,
            'rejection_reason' => $this->rejection_reason,
            'created_at' => $this->created_at,
        ];
    }
}
